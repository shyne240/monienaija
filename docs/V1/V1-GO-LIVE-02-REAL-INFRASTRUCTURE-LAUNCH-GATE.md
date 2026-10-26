# V1-GO-LIVE-02 — Real Production Infrastructure Launch Gate

**Commit tested:** `f51652d357d3fa7160ce87104d722737a2a018a6` ("release: harden V1 production
readiness"), the same commit V1-GO-LIVE-01 tested and closed. No production code was changed
during this audit (see §T, Git Record).

**Audit date:** 2026-10-07. **Sandbox:** headless Linux container with SNI-filtered egress (see
§1).

**Purpose:** V1-GO-LIVE-01 (closed, `f51652d`) was a theoretical/local-only infrastructure
readiness review. This report is the *execution* follow-up: it attempts to convert every
`REQUIRES REAL INFRASTRUCTURE` item from the prior reports into an actually-provisioned,
actually-verified piece of real infrastructure, using whatever real access exists in this
sandbox — and where real access does not exist, it says so plainly and produces an exact,
addressed-to-the-operator action list instead of a second audit.

**Headline finding, stated once, up front:** this sandbox has **zero cloud/database/SMS/OIDC/
mobile-signing credentials**, **zero infrastructure CLIs installed**, and — critically — **its
network egress is SNI-filtered**: DNS resolution and raw TCP connects succeed to arbitrary
third-party hosts, but TLS handshakes to every non-allowlisted host are reset
(`SSL_ERROR_SYSCALL`) immediately after the Client Hello. Only `github.com` and
`registry.npmjs.org` are reachable over TLS. This means real provisioning against any cloud
provider, managed Postgres, SMS gateway (Robase), OIDC provider, or EAS/Apple/Google
mobile-signing service is **categorically impossible from inside this sandbox**, independent of
whether credentials exist. This is a sandbox/environment constraint, not a code defect, and it
is the reason most of Parts D–M below resolve to `REQUIRES REAL INFRASTRUCTURE` /
`REQUIRES USER/REAL INFRASTRUCTURE` rather than live-verified. Evidence for this finding is in
§1; it is not re-derived per part below.

---

## Part A — REQUIRES-REAL-INFRASTRUCTURE register (extracted verbatim from the 4 prior reports)

### A.1 — From `V1-GO-LIVE-01-PRODUCTION-INFRASTRUCTURE-READINESS.md` (re-opened and re-read this
turn, verbatim extraction)

- **Domain/DNS/TLS (§ Part C):** "No domain name is registered or referenced anywhere in the
  repository... Tagged `REQUIRES USER/REAL INFRASTRUCTURE`." No domain was invented.
- **Live SMS (§ Part D):** "No `ROBASE_API_KEY`, `ROBASE_*` credential, or any SMS-provider
  credential exists in this environment... Tagged `REQUIRES REAL INFRASTRUCTURE`." No real SMS
  was sent; console-mode OTP delivery was not represented as production-complete.
- **OIDC / Workforce (§ Part E):** "No OIDC issuer, client ID/secret, or JWKS endpoint is
  configured anywhere... Tagged `REQUIRES REAL INFRASTRUCTURE`." No IdP was invented; the
  SUPPORT workforce password-based path was confirmed to not depend on OIDC.
- **Managed Postgres / backup-restore PITR (§ Part D, backup drill):** real `pg_dump`/`pg_restore`
  were unavailable in-sandbox; the backup/restore drill was executed against the project's own
  embedded-Postgres JS driver instead, and the report explicitly stated this was
  `VERIFIED LOCALLY` (disposable DB), not `VERIFIED IN REAL PROD INFRA`, and that real managed
  Postgres PITR remains `REQUIRES REAL INFRASTRUCTURE`.
- **Mobile store builds / EAS / Apple / Google (§ Part F):** "No EAS account, Apple Developer
  Program membership, or Google Play Console account exists... Tagged
  `REQUIRES REAL INFRASTRUCTURE`." No app-store-readiness claim was made from local `expo
  prebuild`.
- **Monitoring/alerting (§ Part G):** "No monitoring stack (Prometheus/Grafana/Datadog/etc.) is
  deployed or configured... Tagged `REQUIRES REAL INFRASTRUCTURE`." No dashboards were invented.

(V1-GO-LIVE-01's final verdict was **B — PRODUCTION INFRASTRUCTURE PARTIALLY VERIFIED**, using
its own distinct verdict vocabulary; not to be conflated with this report's verdict set.)

### A.2 — From `V1-RELEASE-01-PRODUCTION-DEPLOYMENT-READINESS-AUDIT.md`

- Encryption-at-rest relies on PostgreSQL storage encryption — an infra-layer control, not an
  application control — `REQUIRES REAL INFRASTRUCTURE` per eventual hosting target.
- Network-level restriction of `/internal/*` via reverse proxy is a defense-in-depth
  recommendation the application does not itself enforce — `REQUIRES REAL INFRASTRUCTURE` to
  confirm per target.
- TLS termination is expected at a reverse proxy/load balancer; the application does not
  terminate TLS itself — `REQUIRES REAL INFRASTRUCTURE`.
- Mobile app-store builds (EAS cloud build, signed IPA/AAB) require a real Apple Developer
  account, Google Play Console account, and EAS credentials — `REQUIRES REAL INFRASTRUCTURE` for
  both Customer and Agent mobile apps.
- `.github/` CI/CD pipeline does not exist — tagged `MISSING`, but this matches
  `docs/deployment/DEPLOYMENT.md`'s explicitly declared out-of-scope milestone boundary (cloud
  infra / Kubernetes / Terraform / CI-CD are all explicitly out of the current milestone).
- Backup/recovery native capability selection (pg_dump/pg_restore/PITR/snapshot policy) is
  provider-specific — `REQUIRES REAL INFRASTRUCTURE` once a hosting target is chosen.

### A.3 — From `V1-MOBILE-01-PRODUCTION-BUILD-READINESS.md` §13 (clean 7-item list, verbatim)

1. EAS account + project linkage (no Expo login / no network to expo.dev at the time of that
   audit — now additionally confirmed this turn: TLS to `expo.dev` is SNI-blocked in this
   sandbox, not merely a missing-login issue).
2. Apple Developer Program membership + signing certificates/provisioning profiles.
3. Google Play Console account + upload key / Play App Signing enrollment.
4. Real icon/splash brand artwork — a product/design decision, not a code defect (1024×1024
   icon PNG, no alpha; 1024×1024 adaptive-icon foreground with safe zone; splash PNG; optional
   48×48 favicon).
5. A real, DNS-resolvable staging/production API domain.
6. A physical Android/iOS device, or an emulator/simulator with Google Play services / Xcode —
   this sandbox is headless Linux; none available.
7. A CI/CD pipeline — unchanged gap, no `.github/workflows` directory exists.

### A.4 — From `V1-INFRA-03-PRODUCTION-SURVIVABILITY-AUDIT.md` (equivalent findings under
"Known Limitations" / "Environment limitation" wording rather than the literal
`REQUIRES REAL INFRASTRUCTURE` tag)

- `pg_dump`/`pg_restore` binaries unavailable in-sandbox — the backup/restore capability could
  not be verified against native Postgres tooling (confirmed sandbox-wide again this turn, see
  §1).
- No literal OS-level process-kill-and-restart drill was executed; live cross-process evidence
  (2 real backend processes sharing 1 real database) was used as a strong but not identical
  substitute.
- No live forced-fault-injection test for external dependency failure; this was code-reviewed
  only, not independently live-proven.
- A `DB_HOST`-unset readiness anomaly was noted but not revisited (out of scope here — no new
  evidence presented; not reopened).

---

## Part B — Real infrastructure access inventory (this sandbox, this turn)

| Category | Finding |
|---|---|
| Cloud provider CLIs | `aws`, `gcloud`, `az`, `doctl`, `flyctl`, `heroku`, `vercel`, `netlify`, `railway`, `terraform`, `pulumi`, `kubectl`, `helm` — **all absent**. |
| Database client binaries | `psql`, `pg_dump`, `pg_restore`, `pg_basebackup`, `mysql`, `redis-cli` — **all absent**. Confirms V1-INFRA-03's `pg_dump` gap is sandbox-wide, not task-specific. |
| Cert/DNS tooling | `certbot`, `dig`, `nslookup`, `route53`, `cloudflared` — **all absent**. Only `openssl` is present. |
| Mobile build tooling | `eas`, `expo`, `xcodebuild`, `gradle`, `fastlane` native binaries — **all absent**. `npx eas-cli` can be fetched on demand from the npm registry (confirmed: auto-installed `eas-cli@24.11.0`) — this supplies the *tool* only, not credentials or network access to actually build/sign. |
| Environment variables | Exhaustive scan for cloud/SaaS/SMS/OIDC/monitoring credential variable name patterns found **zero** matches. Only `GH_TOKEN`/`GITHUB_TOKEN` exist, and those are git-operations credentials only. |
| Network egress (critical finding) | DNS resolution succeeds for arbitrary hosts (`api.robase.dev`, `expo.dev`, `api.expo.dev`, `auth0.com`, `accounts.google.com`). Raw TCP connect-on-443 also succeeds for the same hosts. **TLS handshakes to every one of those hosts fail with `SSL_ERROR_SYSCALL` immediately after the Client Hello** — consistent with SNI-based egress filtering/proxying that resets connections to non-allowlisted hostnames. Only `github.com` (HTTP 200) and `registry.npmjs.org` (HTTP 200) are reachable over TLS. |

**Conclusion for this report:** real infrastructure provisioning or live verification against
any third-party cloud, database, SMS, OIDC, or mobile-signing provider is **not possible from
inside this sandbox** — this is a network-egress-allowlist constraint on top of (not instead of)
the missing-credentials gap. Parts D, E, F, G, H, J, K, L, and M below are therefore resolved by
inspection/runbook/local-proxy verification rather than live third-party calls, and each is
labelled precisely per the task's label discipline.

---

## Part C — Intended hosting target (repo search)

No infrastructure-as-code of any kind exists in the repository beyond a generic, provider-neutral
`Dockerfile` (multi-stage Node 22-alpine build) and a `docker-compose.yml` that defines only a
**local development** `postgres:16-alpine` service — it does not define an application service,
is not deploy-ready, and is not referenced by any CI/CD workflow (none exists). A repo-wide
search for `.tf`, `Procfile`, `fly.toml`, `render.yaml`, and `app.yaml` found nothing beyond those
two files.

A provider-name grep (`render|railway|fly|heroku|aws|digitalocean|vercel|netlify|azure|gcp|
supabase|neon|planetscale`) across `docs/` and `README.md` hit 10 files. On inspection, every hit
is either (a) a generic illustrative example — e.g. `V1-AGENT-MOBILE-17-RELEASE-INFRASTRUCTURE-
HANDOFF.md` says only *"PostgreSQL 16+ (`postgres:16-alpine` or managed AWS RDS / GCP Cloud
SQL)"*, offering two options as examples, not a decision — or (b) an unrelated string match (e.g.
"Fly" appearing inside an unrelated English sentence, or "AWS" as a substring of an unrelated
token). **No file commits the project to a specific hosting provider.** This is consistent with
`docs/deployment/DEPLOYMENT.md`, which explicitly states cloud infrastructure, Kubernetes,
Terraform, and CI/CD are out of the current milestone's scope.

**Resolution: `REQUIRES USER DECISION`.** No provider was picked. The following infra-decision
list is produced for Kenneth (the operator) to resolve before any of Parts D–M can move past
"runbook" into "provisioned":

| Decision | Options (illustrative, not a recommendation) | Blocks |
|---|---|---|
| Compute/app-hosting provider | Render, Railway, Fly.io, a VPS + Docker Compose, AWS/GCP/Azure, etc. | Parts D, F, I, M, O |
| Managed Postgres provider | Same provider's managed PG, or a separate managed-PG vendor (Neon, Supabase, RDS, Cloud SQL) | Part D |
| Domain name + registrar | Any registrar; must be purchased/owned by Kenneth or the business entity | Part F |
| TLS certificate strategy | Provider-managed TLS (e.g. Render/Fly auto-TLS) vs. self-managed (Let's Encrypt/Certbot) | Part F |
| SMS provider production account | Robase (already coded against) production API key + verified sender ID | Part G |
| OIDC/workforce IdP | Auth0, Okta, Google Workspace, Azure AD, or "skip OIDC, SUPPORT-only password auth" | Part H |
| Monitoring/alerting stack | Provider-native dashboards, or a separate APM (Datadog, Grafana Cloud, etc.) | Part M |
| Backup/PITR policy owner | Provider-native automated backups vs. a custom cron+off-site-storage job | Part E |

This decision list does not block Parts N, O (as a runbook), P, or Q below, all of which are
executed in full in this report.

---

## Part D — Managed Postgres

**Status: `REQUIRES REAL INFRASTRUCTURE`** (no managed Postgres provider is reachable or chosen;
see §B, §C). **What was actually executed locally this turn** (VERIFIED LOCALLY-DISPOSABLE, not a
substitute for managed-PG verification):

- Installed dependencies (`npm ci`, 930 packages) and built the application (`npm run build`) —
  clean, 0 errors.
- Started a fresh embedded Postgres 18.4 instance and ran all migrations from zero:
  `npm run migration:run` → all 82 migrations applied cleanly; `npm run migration:show` confirms
  `82/82 [X]`.
- Re-ran `npm run migration:run` a second time against the now-migrated database → `No
  migrations are pending` (idempotency confirmed).
- Started the built backend (`node dist/main.js`) against this fresh database → booted cleanly,
  all ~115 routes mapped, capability registry seeded (114 capabilities), product catalogue seeded
  (7 products), `GET /api/v1/health` → `200 {"status":"ok",...}`.
- Sent `SIGTERM` to the running process → log shows
  `{"context":"GracefulShutdownService","signal":"SIGTERM","drained":true,"activeRequests":0,
  "msg":"Application drain complete"}` before exit — graceful shutdown re-confirmed live this
  session.
- Restarted the backend against the **same, already-migrated** database → booted cleanly with no
  schema errors, `GET /api/v1/health` → `200 OK` again. Confirms restart-with-existing-data
  safety.

**Exact runbook for a real managed-Postgres provision** (to be executed by Kenneth once a
provider is chosen per Part C):
1. Provision a managed PostgreSQL 16+ instance (match the version pinned in
   `docker-compose.yml`/CI).
2. Enable the `uuid-ossp` extension (the app's migrations issue `CREATE EXTENSION IF NOT EXISTS
   "uuid-ossp"` automatically — confirmed in the migration log above — so this is self-serve as
   long as the DB role has `CREATE EXTENSION` privilege; otherwise the provider must pre-enable
   it).
3. Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL=true` (or the
   provider's equivalent TLS flag) as the deployment's environment variables — do not reuse the
   `.env.example` dev defaults.
4. Run `npm run migration:run` once, pointed at the managed instance, from a trusted deploy host
   (CI runner or operator machine) — **never from inside this sandbox**, since this sandbox
   cannot reach any real managed-Postgres endpoint (egress block, §B).
5. Run `npm run migration:show` and confirm all 82 migrations show `[X]`.
6. Start the backend pointed at the managed instance and confirm `GET /api/v1/health` returns
   `200` and `GET /api/v1/internal/readiness` (with a valid admin bearer token) reports the
   database as healthy.
7. Never claim production-DB readiness from a localhost/embedded Postgres instance — this report
   does not make that claim; §D's "VERIFIED LOCALLY" results only prove the migration set and
   application code are internally consistent and idempotent, not that the real managed-Postgres
   target is reachable or correctly configured.

---

## Part E — Backup / restore (PITR)

**Status: `REQUIRES REAL INFRASTRUCTURE`** for a genuine point-in-time-recovery drill against a
managed provider's PITR facility — no such provider is reachable from this sandbox.

The existing `scripts/go-live-01-backup-drill.js` (committed in `f51652d`, unchanged this turn)
remains the correct vendor-neutral drill script. It preserves the known, previously-verified
requirement that **the ledger's deferred balance-check constraint trigger requires the restore to
run inside one explicit transaction** (`BEGIN; <restore DDL/DML>; COMMIT;`), because the
constraint is `DEFERRABLE INITIALLY DEFERRED` and only evaluates at transaction commit — running
restore statements autocommitted, one at a time, will spuriously trip the constraint mid-restore
on a table that is temporarily imbalanced between statements. This was proven in V1-GO-LIVE-01
and is not re-litigated here (no new evidence).

**No real PITR operation was attempted or claimed this turn** — doing so would require a real
managed-Postgres provider with PITR enabled, which does not exist in or reach this sandbox.

**Exact runbook once a provider is chosen (Part C):**
1. Confirm the provider's PITR/continuous-backup feature is enabled on the production instance
   (e.g. "Point-in-Time Recovery" toggle, WAL archiving, or automated daily snapshot + WAL
   shipping, depending on vendor).
2. Record the provider's retention window (RPO) and restore time objective (RTO) in
   `docs/operations/` once known — do not invent a number.
3. Run a **non-destructive drill**: restore into a *new, separate* instance (never overwrite
   production), using the provider's "restore to new instance" feature or
   `scripts/go-live-01-backup-drill.js`'s approach adapted to the provider's actual
   `pg_dump`/`pg_restore` or snapshot tooling.
4. Verify financial invariants (ledger balance, `wallet_accounts` sum reconciliation, idempotency
   key uniqueness) directly against the restored instance via SQL, not application-level checks.
5. Confirm the restore executed the ledger DDL/DML inside one transaction (per the trigger
   requirement above) — if the provider's restore tooling autocommits per-statement, this step
   needs a custom wrapper script, not the vendor default.
6. Only after a real restore has been executed and verified against real provider infrastructure
   may this be marked `VERIFIED IN REAL PROD INFRA` — it is not so marked in this report.

---

## Part F — Domain / DNS / TLS

**Status: `REQUIRES USER/REAL INFRASTRUCTURE`.** No domain name exists anywhere in the repository
or environment; none was invented. Exact information needed from Kenneth:
1. A registered domain name (or confirmation of an existing one not yet documented).
2. DNS hosting/registrar access (to create `A`/`AAAA`/`CNAME` records pointing at the chosen
   compute provider).
3. A TLS certificate strategy decision (provider-managed auto-TLS vs. self-managed
   Let's Encrypt/Certbot) — see Part C decision list.
4. Confirmation of whether admin-web, the backend API, and any mobile deep-link domain will be
   the same origin or different subdomains (this affects the CORS analysis in Part I).

No TLS claims are made from localhost; `openssl` is present in-sandbox but was not used to
fabricate a self-signed "verification" — that would not constitute real TLS verification of a
production endpoint.

---

## Part G — Live SMS (Robase)

**Status: `REQUIRES REAL INFRASTRUCTURE`.** No `ROBASE_API_KEY` or any Robase credential exists
in this environment, and even if one were supplied, TLS to `api.robase.dev` is blocked by this
sandbox's SNI filtering (§B) — confirmed via `curl -v`: Client Hello sent, then
`SSL_ERROR_SYSCALL`. No live SMS was sent; no console-mode OTP delivery is represented as
production-equivalent. This turn additionally **live-confirmed** (see Part N) that the
application's own environment validation refuses to boot under `NODE_ENV=production` with the
default `console` SMS provider, and separately refuses to boot with `NOTIFICATION_SMS_PROVIDER=
robase` set but `ROBASE_API_KEY` absent — both fail-fast guards were exercised live this session,
not merely re-cited from the prior audit.

**Runbook once a real Robase production account exists:**
1. Obtain a Robase production API key and a verified/approved sender ID for Nigeria SMS
   delivery.
2. Set `NOTIFICATION_SMS_PROVIDER=robase` and `ROBASE_API_KEY=<real key>` in the production
   environment.
3. From a host that *can* reach `api.robase.dev` (i.e., not this sandbox), run one controlled
   OTP test to a real operator-owned phone number and confirm delivery.
4. Check Robase's dashboard/API logs for the test to confirm no credential leakage occurred
   (e.g. the key is not echoed in application logs — confirmed by code review in V1-GO-LIVE-01
   that the SMS client does not log the API key; not re-litigated here).
5. Only after a real SMS is actually delivered and confirmed may this be marked
   `VERIFIED IN REAL PROD INFRA`.

---

## Part H — Workforce / OIDC

**Status: `REQUIRES REAL INFRASTRUCTURE`** for OIDC specifically (no IdP, client ID/secret, or
JWKS endpoint exists or is reachable — Auth0/Google both fail the same SNI-blocked-TLS pattern as
Robase/Expo, confirmed in §B). No IdP was invented.

**SUPPORT workforce flow re-verified operational this session** (does not depend on OIDC):
- Started a fresh backend against a freshly migrated database.
- `POST /api/v1/internal/a2/workforce/sessions` with a mock OIDC token → `401
  {"message":"Workforce authentication disabled"}` — confirms the OIDC-backed A2 workforce path
  correctly fails closed when disabled, rather than silently accepting a mock/dev token.
- `POST /api/v1/internal/support/workforce-sessions` with invalid credentials → `401
  {"message":"Invalid support credentials"}` — a clean, well-formed rejection (not a 500), which
  is the expected behaviour on a path with no provisioned SUPPORT user yet. This directly
  re-confirms the login endpoint's error handling live this session.
- The full positive-path round trip (provision a SUPPORT workforce user via the anchor-admin
  ceremony → log in with real credentials → operate the ticket queue) was already proven live in
  prior sessions against this same code (no SUPPORT-auth-related code has changed since); it was
  not re-run in full this turn to avoid repeating a theoretical/full audit the task explicitly
  asked not to repeat without new evidence. The negative-path checks above are the "remains
  operational" confirmation requested by this task.

**Runbook once a real OIDC provider is chosen:** configure the issuer URL, client ID/secret, and
redirect URIs per `docs/deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md`; verify a real OIDC login
round-trip from a host that can reach the chosen IdP (not this sandbox).

---

## Part I — Admin-web deploy

**Status: `REQUIRES USER/REAL INFRASTRUCTURE`** for an actual deployment (no compute target
chosen, Part C). What is re-confirmed by code inspection this turn (no code changed):
- `apps/admin-web/vite.config.ts` injects `ADMIN_WEB_API_BASE_URL` from the **build-time**
  environment via Vite's `define`, with no hardcoded localhost fallback baked into production
  bundles — this was the V1-RELEASE-01 fix and remains in place, unchanged.
- `DEV_AUTH_MOCK` in `apps/admin-web/src/config/index.ts` is defined as
  `process.env.NODE_ENV !== 'production'`. Vite statically replaces `process.env.NODE_ENV` with
  the build mode at build time (standard Vite behaviour, no extra config needed), so a
  `vite build` (default mode `production`) bakes `DEV_AUTH_MOCK = false` into the production
  bundle — there is no dev-bypass reachable in a correctly built production artifact.
- No CORS code exists anywhere in `src/` (`grep` for `cors`/`Access-Control-Allow-Origin` across
  `src/**/*.ts`, excluding specs, returned zero matches) — this remains the intentional,
  documented same-origin architecture from V1-INFRA-03 (standing instruction: do not reopen).

**If admin-web is deployed to the same origin as the backend API** (reverse-proxied under one
domain), the existing no-CORS architecture is preserved automatically and no changes are needed.
**If admin-web is deployed to a different origin** than the backend API, this is a `STOP AND
ASSESS` condition per task instruction — cross-origin would require either (a) a reverse proxy
that makes the API appear same-origin to the browser, or (b) deliberate, narrowly-scoped CORS
configuration (never a wildcard). This decision depends on the Part C compute-topology choice and
was not resolved here, since no hosting target exists yet.

---

## Part J — Customer Mobile prod build

**Status: `REQUIRES REAL INFRASTRUCTURE`.** EAS, Apple, and Google are all unreachable from this
sandbox (§B). Static production config was re-verified unchanged and correct this turn:

| Field | Value |
|---|---|
| App name | MoneyNaija |
| Slug | moneynaija-customer |
| Version | 1.0.0 |
| iOS bundle ID | `ng.monienaija.customer` |
| iOS build number | 1 |
| Android package | `ng.monienaija.customer` |
| Android version code | 1 |
| `eas.json` | present |

No real EAS build, artifact URL, or app-store-readiness claim is made. Runbook: once a real EAS
account + Apple/Google developer accounts exist, run `eas build --platform all --profile
production` from a host that can reach `expo.dev`/`api.expo.dev` (not this sandbox), then
download and inspect the resulting artifact for the correct bundle ID/API URL before any store
submission.

---

## Part K — Agent Mobile prod build

**Status: `REQUIRES REAL INFRASTRUCTURE`**, same reasoning as Part J. Static config re-verified
this turn:

| Field | Value |
|---|---|
| App name | MoneyNaija Agent |
| Slug | moneynaija-agent |
| Version | 1.0.0 |
| iOS bundle ID | `ng.monienaija.agent` |
| iOS build number | 1 |
| Android package | `ng.monienaija.agent` |
| Android version code | 1 |
| `eas.json` | present |

No physical Android/iOS devices are available in this sandbox (expected, confirmed again this
turn — headless Linux, no emulator/simulator tooling installed). No emulator run is substituted
for a real-device verification claim. Once a real signed build artifact exists, the secure
auth/PIN/Cash-In/W2C/C2C/history/logout flows must be re-verified by installing that artifact on
a real device — this cannot be done from this sandbox and is not claimed here.

---

## Part L — Real E2E prod smoke test

**Status: `REQUIRES REAL INFRASTRUCTURE` (not attempted).** No production environment is
reachable or exists (no domain, no deployed backend, no managed DB — Parts D, F). Per task
instruction, this part is only executable "if prod env reachable," and it is not. No real
customer financial transactions were performed, and none will be performed against a
non-existent production environment. The 15-step Customer+Agent flow and its 12 Postgres
financial invariants remain documented and already proven against local/disposable Postgres in
prior sessions (V1-GO-LIVE-01); that evidence is not re-claimed as production evidence here.

---

## Part M — Production monitoring

**Status: `REQUIRES REAL INFRASTRUCTURE`.** No monitoring/alerting stack is deployed or
configured anywhere, and none can be stood up against a real provider from this sandbox (no cloud
CLI, no reachable SaaS monitoring API — §B). No dashboards are invented. Required capability list
(unchanged from V1-GO-LIVE-01, restated here since the task requires each category enumerated):
backend-down detection, Postgres-down detection, 5xx rate spikes, auth-failure rate, OTP-failure
rate, SMS-delivery-failure rate, transaction-failure rate, DB connection-pool contention,
rate-limit-rejection spikes, and migration-failure alerting on deploy. None of these can be wired
up without a chosen monitoring provider (Part C) and a reachable production environment (Parts D,
F).

---

## Part N — Production security gate (executed fully, locally, this turn)

All checks below were **actually executed live this session** against the built application
(`dist/main.js`), not re-cited from memory:

| Check | Result |
|---|---|
| `NODE_ENV=production` + default `console` SMS provider | **Fails fast**: `Application startup failed: Invalid environment configuration: NOTIFICATION_SMS_PROVIDER: A production deployment must set NOTIFICATION_SMS_PROVIDER=robase...` — process exits non-zero before any route is mapped. |
| `NODE_ENV=production` + `NOTIFICATION_SMS_PROVIDER=robase` + no `ROBASE_API_KEY` | **Fails fast**: `Invalid environment configuration: ROBASE_API_KEY: ROBASE_API_KEY is required when NOTIFICATION_SMS_PROVIDER=robase`. |
| `NODE_ENV=production` + full `.env.example` + the two required production overrides (`NOTIFICATION_SMS_PROVIDER=robase`, a syntactically valid `ROBASE_API_KEY`) | **Boots cleanly**, `GET /api/v1/health` → `200 OK`. Confirms the V1-GO-LIVE-01 P0 fix holds under a genuine `NODE_ENV=production` boot, not just `staging`. No second P0 found. |
| `DEV_AUTH_MOCK` in admin-web | Defined as `process.env.NODE_ENV !== 'production'`; Vite bakes this to `false` for any standard `vite build` (production mode) — no dev-bypass reachable in a correctly built artifact. |
| Default DB credentials | `.env.example` ships `DB_PASSWORD=change-me-local-only` — an obviously-named placeholder, not a silently-accepted production default (a real managed-Postgres instance will simply reject the connection unless this is overridden). Flagged for the operator checklist below regardless. |
| Wildcard CORS | `grep` for `cors`/`Access-Control-Allow-Origin` across `src/**/*.ts` (excluding specs) → zero matches. No CORS middleware exists at all (intentional, same-origin architecture — standing instruction, not reopened). |
| Localhost hardcoded as a production API URL | None found; admin-web sources its API base URL from a build-time env var with no localhost fallback (Part I). |
| Debug/diagnostic endpoints reachable without auth | `GET /api/v1/internal/readiness` → `401`; `GET /api/v1/internal/diagnostics` → `401`; `GET /api/v1/internal/configuration` → `401`; `GET /api/v1/internal/version` → `200` (confirmed intentionally public — returns only `{"current":"v1","supported":["v1"],"deprecated":[],"header":"X-API-Version","discoveredAt":...}`, no secrets, no internal config). |
| Verbose errors / secrets in logs | Boot-failure error messages above are intentionally descriptive but contain no secret values (no API keys, passwords, or tokens are printed — only variable *names* and the validation rule that was violated). |
| Dev-OIDC bypass | A2 workforce OIDC path returns `401 "Workforce authentication disabled"` when disabled and does not accept a mock token — confirmed live this session (Part H). |
| Graceful shutdown / no abrupt data loss on redeploy | `SIGTERM` → `GracefulShutdownService` logs `drained:true, activeRequests:0` before exit — confirmed live this session (Part D). |

**No P0 or P1 was found in this gate.** All guards that were previously fixed (V1-GO-LIVE-01)
were re-exercised live this turn and continue to hold.

---

## Part O — Release / rollback runbook

1. **Provision managed Postgres** per the chosen provider (Part C/D); record connection details
   in a secrets manager, not in source control.
2. **Set production secrets**: `DB_*`, `NOTIFICATION_SMS_PROVIDER=robase` + `ROBASE_API_KEY`,
   `NODE_ENV=production`, and any OIDC client credentials if Part H's IdP decision selects one.
3. **Run migrations** (`npm run migration:run`) against the managed instance from a trusted
   deploy host; confirm `82/82 [X]` via `npm run migration:show`.
4. **Deploy the backend** (`docker build .` using the existing root `Dockerfile`, or the chosen
   provider's native build) and confirm the container starts without the environment-validation
   failures demonstrated in Part N.
5. **Readiness check**: `GET /api/v1/health` → `200`; `GET /api/v1/internal/readiness` (with a
   valid admin bearer token) → confirms DB connectivity.
6. **Deploy admin-web**, built with the correct `ADMIN_WEB_API_BASE_URL` for the chosen topology;
   confirm same-origin (preferred) or explicitly assessed cross-origin handling (Part I).
7. **Configure mobile production builds**: confirm `eas.json` production profile points at the
   real production API URL; do not ship a build pointed at staging/localhost.
8. **Verify live SMS** with one controlled, operator-owned-number OTP test (Part G) — do not
   proceed to traffic-enable until this succeeds.
9. **Run the smoke test** (Part L's 15-step Customer+Agent flow) against the new production
   environment, verifying all financial results directly in Postgres — never using real customer
   funds.
10. **Enable traffic** (DNS cutover / load-balancer target update).
11. **Rollback plan**: keep the previous container image/tag deployable; on failure, redirect
    traffic back to it and re-run the readiness check against the prior version. (Not tested in
    this sandbox — no real deploy target exists; this is a documented plan, not a tested
    procedure, and is not claimed as tested.)
12. **Backup/restore**: confirm the provider's PITR is enabled (Part E) before go-live; the
    ledger-restore-transaction requirement (single explicit transaction, due to the deferred
    balance-check constraint) must be respected by any custom restore tooling.
13. **Emergency shutdown**: `SIGTERM` the backend process (confirmed to drain gracefully, Part N)
    and/or disable traffic at the load balancer/DNS level; do not `kill -9` as a first resort.

---

## Part P — `.env.example` vs. actual production config (re-validated live this turn)

Re-ran the exact class of check that found V1-GO-LIVE-01's P0 (shipped `.env.example` silently
bootable under `NODE_ENV=production` with a non-functional SMS provider). This turn's live tests
(Part N) confirm:
- The default `.env.example` **cannot** boot under `NODE_ENV=production` without an explicit,
  deliberate override of `NOTIFICATION_SMS_PROVIDER` and `ROBASE_API_KEY` — both omissions throw
  descriptive, named validation errors and crash the process before any route is mapped.
- Every other `.env.example` variable either ships a safe, documented default (e.g. retention
  windows, timeouts, `A6_PARTNER_ENABLED=false`) or is a placeholder clearly named as such
  (`DB_PASSWORD=change-me-local-only`) that a real managed-Postgres connection will simply reject
  if left unchanged — it does not silently "work" against a real production database.
- No second P0 was found. `.env.example` remains safe to ship as a reference template for
  deployers, who must still explicitly set `DB_*`, `NOTIFICATION_SMS_PROVIDER=robase` +
  `ROBASE_API_KEY`, and any OIDC credentials before a real production boot — which the
  application itself enforces by refusing to start otherwise.

---

## Part Q — Final release matrix

| AREA | STATUS | EVIDENCE | BLOCKER | NEXT ACTION |
|---|---|---|---|---|
| Backend application code | VERIFIED LOCALLY | Clean `npm run build`; boots against fresh + restarted embedded PG; graceful SIGTERM drain confirmed live | — | None — ready to deploy pending infra |
| Managed PostgreSQL | REQUIRES REAL INFRASTRUCTURE | 82/82 migrations clean + idempotent against embedded PG; no managed-PG access exists | No cloud DB provider chosen/reachable | Kenneth: choose provider (Part C), provision, run Part D runbook |
| Migrations | VERIFIED LOCALLY | `82/82 [X]`, re-run is no-op | — | Re-run against managed PG once provisioned |
| Backups / PITR | REQUIRES REAL INFRASTRUCTURE | Vendor-neutral drill script exists (`scripts/go-live-01-backup-drill.js`), ledger-restore-transaction requirement documented | No managed-PG PITR facility reachable | Kenneth: enable provider PITR, run Part E runbook |
| Domain | REQUIRES USER DECISION | No domain in repo or env | No domain registered | Kenneth: register/provide a domain |
| DNS | REQUIRES USER/REAL INFRASTRUCTURE | — | Depends on domain + compute choice | Kenneth: configure DNS once compute is chosen |
| TLS | REQUIRES USER/REAL INFRASTRUCTURE | — | Depends on domain + hosting choice | Kenneth: pick provider-managed vs. self-managed TLS |
| SMS (Robase) | REQUIRES REAL INFRASTRUCTURE | Fail-fast guards confirmed live (Part N); TLS to api.robase.dev blocked in-sandbox | No Robase prod credential; sandbox can't reach Robase anyway | Kenneth: obtain Robase prod key, test from a reachable host |
| Customer Mobile | REQUIRES REAL INFRASTRUCTURE | Static config verified correct (bundle IDs, versions, eas.json present) | No EAS/Apple/Google accounts; sandbox can't reach expo.dev | Kenneth: provision EAS/Apple/Google, run real build |
| Agent Mobile | REQUIRES REAL INFRASTRUCTURE | Same as above | Same as above, plus no physical device available | Kenneth: provision accounts + a real test device |
| admin-web | REQUIRES USER/REAL INFRASTRUCTURE | No-CORS architecture + build-time API URL injection confirmed by code inspection | No compute target chosen | Kenneth: choose topology (Part C); if cross-origin, re-assess CORS per Part I |
| OIDC | REQUIRES REAL INFRASTRUCTURE | A2 workforce fails closed when disabled (confirmed live) | No IdP chosen/reachable | Kenneth: choose IdP (Part C) or confirm SUPPORT-only is acceptable for launch |
| SUPPORT workforce | VERIFIED LOCALLY | Negative-path (invalid creds → clean 401) re-confirmed live this turn; full positive round trip previously proven, code unchanged since | — | None — independent of OIDC decision |
| Monitoring | REQUIRES REAL INFRASTRUCTURE | Required alert categories enumerated (Part M) | No provider chosen/reachable | Kenneth: choose monitoring provider (Part C) |
| Deployment | REQUIRES USER/REAL INFRASTRUCTURE | `Dockerfile` builds cleanly; no deploy target exists | No compute provider chosen | Kenneth: choose provider, execute Part O steps 1–7 |
| Rollback | OUT OF SCOPE (not testable) | Documented 13-step runbook (Part O) | No real deploy exists to roll back from | Test once a real deploy exists |
| Financial E2E smoke (prod) | REQUIRES REAL INFRASTRUCTURE | 15-step flow + invariants already proven against local PG in prior sessions | No reachable production environment | Run once production exists (Part O step 9) |
| Security gate | VERIFIED LOCALLY | All checks in Part N executed live this turn; zero P0/P1 found | — | Re-run this gate after any future env/config change |

---

## VERIFIED IN REAL PROD INFRA

None. No real external production infrastructure (cloud compute, managed database, domain,
SMS gateway, OIDC provider, or mobile-build-signing service) was reachable from this sandbox this
turn (see §B).

## VERIFIED LOCALLY-DISPOSABLE

- Backend build, 82/82 migration application + idempotency, clean boot, graceful SIGTERM drain,
  and clean restart against existing data — all against a fresh embedded Postgres instance
  created and destroyed this session.
- Full production security gate (Part N): `NODE_ENV=production` fail-fast guards for
  console-SMS and missing-`ROBASE_API_KEY`; clean production boot once both are set correctly;
  no wildcard CORS; no dev-OIDC bypass; debug endpoints correctly gated; graceful shutdown.
- SUPPORT workforce negative-path re-confirmation (clean 401s, not 500s; A2 OIDC path fails
  closed when disabled).
- Static mobile production config (bundle IDs, versions, `eas.json` presence) for both Customer
  and Agent apps.

## REQUIRES REAL INFRASTRUCTURE

Managed PostgreSQL provisioning (Part D); real PITR backup/restore drill (Part E); live SMS
delivery via Robase (Part G); OIDC provider configuration (Part H); EAS/Apple/Google mobile
signed builds for both apps (Parts J, K); production monitoring/alerting stack (Part M); real
E2E production financial smoke test (Part L) — none reachable or provisionable from this sandbox
due to the combination of zero credentials and SNI-filtered egress documented in §B.

## REQUIRES USER DECISION

Hosting/compute provider, managed-Postgres provider, domain registrar, TLS strategy, SMS
production account ownership, OIDC/IdP choice (or explicit "SUPPORT-only, no OIDC for launch"),
monitoring provider, and backup/PITR policy ownership — see Part C's itemized table. None of
these were picked on Kenneth's behalf.

## BLOCKED

None distinct from the REQUIRES REAL INFRASTRUCTURE items above — every blocker in this report
traces back to either missing external credentials/accounts or this sandbox's SNI-filtered
egress, both of which are documented once in §B rather than repeated as separate "BLOCKED"
entries per part.

## OUT OF SCOPE

CI/CD pipeline creation (`.github/workflows`) — explicitly out of the current milestone per
`docs/deployment/DEPLOYMENT.md`, not reopened here. Rollback *testing* (as opposed to the
documented runbook) — cannot be tested without a real deployed environment to roll back from.

---

## Final Verdict

**B — PRODUCTION INFRASTRUCTURE PARTIALLY VERIFIED — EXTERNAL ACTIONS REMAIN.**

Everything executable from inside this sandbox was executed for real this turn (build, migration
application and idempotency, clean/restart boot behaviour, graceful shutdown, the full production
security gate, and the `.env.example`-vs-production-config re-validation) and all of it passed
with zero new P0/P1 findings. Every remaining item requires either a provider decision Kenneth has
not yet made (Part C) or real external infrastructure/credentials this sandbox cannot reach
regardless of credentials (the SNI-filtered egress documented in §B). None of those were
fabricated, substituted, or claimed as done. The operator checklist below is the exact, addressed
action list needed to move from B to a true go-live.

---

## Operator checklist — for Kenneth

Before go-live, please:

1. **Pick a hosting/compute provider** (Render, Railway, Fly.io, a VPS, AWS/GCP/Azure, etc.) —
   see Part C's decision table.
2. **Pick (or confirm) a managed PostgreSQL provider** and provision an instance; hand the
   connection string to whoever runs the deploy (never paste it in chat).
3. **Register or confirm a domain name** and provide DNS/registrar access to the deploy
   operator.
4. **Decide the TLS strategy** (provider-managed vs. self-managed).
5. **Obtain a Robase production API key** (and a verified SMS sender ID) and set
   `NOTIFICATION_SMS_PROVIDER=robase` + `ROBASE_API_KEY` in the production environment — the
   application will refuse to boot in `NODE_ENV=production` without this, by design.
6. **Decide on an OIDC/IdP provider for workforce login**, or explicitly confirm that
   SUPPORT's password-based login is sufficient for launch (it is already fully operational and
   does not depend on OIDC).
7. **Create a real Expo/EAS account**, a real Apple Developer Program membership, and a real
   Google Play Console account before attempting app-store submission for either mobile app.
8. **Choose a monitoring/alerting provider** and wire it to detect: backend down, Postgres down,
   5xx spikes, auth failures, OTP failures, SMS failures, transaction failures, DB contention,
   rate-limit spikes, and migration failures.
9. Once the above are in place, run the 13-step release runbook (Part O) from a host that can
   actually reach the chosen providers — **not from this sandbox**, which cannot reach any of
   them due to its network egress restrictions.
10. Change the default `DB_PASSWORD=change-me-local-only` value before using `.env.example` as a
    template for any real environment.

No paid infrastructure was created, no real secrets were committed, no real customer financial
data was used, and no external verification was fabricated anywhere in this report.
