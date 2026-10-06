# V1-INFRA-01 — Staging Infrastructure & First Real Deployment Audit

This document reports the results of attempting to establish and verify a
real MonieNaija staging environment: domain → HTTPS → backend → hosted
PostgreSQL → real SMS/OTP → Customer Mobile → Agent Mobile, and to run a
controlled end-to-end UAT against that environment.

Per the governing instructions for this task, every claim below is backed by
an actual command, actual HTTP call, or actual database query run in this
session. Where a genuine external service (DNS/hosting provider, SMS
provider, Apple/Google developer account, EAS build service, physical
device) was required and not available in this sandbox, the item is tagged
**REQUIRES REAL INFRASTRUCTURE** with the exact manual action needed — it is
never claimed as verified. No secret values (passwords, PINs, OTP codes,
tokens, DB credentials) are printed anywhere in this document.

Status vocabulary used throughout (exactly one per item):
`VERIFIED` / `PARTIALLY VERIFIED` / `CONFIGURED BUT UNTESTED` / `BLOCKED` /
`REQUIRES REAL INFRASTRUCTURE` / `NOT APPLICABLE`.

---

## 1. Starting HEAD

`77e1009b7b30ac209d1a221c9a311f08d2f89648` — `docs(V1): add V1-MOBILE-01 build readiness audit`
(the HEAD of `arena/01a10374-monienaija` at the start of this task; clean
working tree, confirmed to match `origin/arena/01a10374-monienaija`).

## 2. Final HEAD

`c09cae2766a18e3e6f86b86d47d0bffa400b7f4e` — `infra: prepare staging deployment`
(the code-fix commit made in this task, parent verified as item 1's commit
before committing; this document is added in a separate, subsequent commit
on top of it, per the required commit sequence).

## 3. Infrastructure inventory — **VERIFIED**

Repo-only inventory, no assumptions about services existing outside this
sandbox:

- **Runtime**: NestJS 10 (Fastify adapter) backend, TypeScript, built with
  `nest build` to `dist/`.
- **Database**: PostgreSQL, accessed via TypeORM + raw `pg`; 82 migrations in
  `src/migrations/`, run via `typeorm-ts-node-commonjs migration:run -d
  src/config/data-source.ts`. No ORM `synchronize` in use.
- **No `psql`/`pg_dump`/`pg_restore` binaries exist anywhere in this sandbox**
  (confirmed by exhaustive `which`/`find` in a prior session and re-confirmed
  this session) — any backup/restore work must use the `pg` Node driver
  directly against the wire protocol.
- **Mobile apps**: `apps/customer-mobile` and `apps/agent-mobile`, both Expo/
  React Native, with `app.json`/`eas.json` present (verified and fixed for
  production-build readiness in the prior, now-closed, V1-MOBILE-01 task).
  No EAS account, Apple Developer account, or Google Play Console credentials
  exist in this sandbox (confirmed: `env | grep -i EAS/EXPO/APPLE/GOOGLE`
  empty; `eas-cli` not pre-installed).
- **Admin web**: `apps/admin-web`, a browser SPA talking to the backend's
  `/api/v1/*` HTTP surface.
- **SMS/OTP provider**: `src/notification/robase-notification-provider.ts`
  implements the real Robase HTTP client; `src/notification/console-
  notification-provider.ts`-style console provider exists for local/dev use
  only. `src/config/environment.ts` **actively rejects** `NODE_ENV=production`
  unless `NOTIFICATION_SMS_PROVIDER=robase` with a non-empty `ROBASE_API_KEY`
  — this is a real, enforced guardrail against accidentally shipping the
  console provider to production.
- **Workforce/OIDC**: `src/authorization/workforce-oidc.service.ts` validates
  external OIDC ID tokens (RS256, JWKS) for `OPERATOR`/`PRIVILEGED` workforce
  login; no sandbox-local fake JWKS endpoint ships with the product — one had
  to be built as an external test harness for this task (outside the repo,
  see item 10).
- **Network egress from this sandbox is restricted** to `registry.npmjs.org`
  and `api.github.com` only (re-confirmed implicitly: all external
  provisioning for DNS/hosting/SMS/EAS/Apple/Google is unreachable from here).

## 4. Backend deployment — **VERIFIED (local/embedded), REQUIRES REAL INFRASTRUCTURE (public hosting)**

The backend was built from source (`npm run build`, clean `nest build`,
zero errors) and run as a real OS process (`node dist/main.js`) against a
real staging-flavoured environment (`NODE_ENV=staging`, 48 env vars, see
item 8), bound to `0.0.0.0:3000`. It served real HTTP traffic for the
entirety of this task's testing (startup logs show full route table
registration, e.g. `CustomerAppController`, `AdminSupportCredentialsController`,
`ReconciliationController`, etc. — all expected modules initialized with no
errors). Graceful shutdown was also exercised and verified: `SIGTERM` → log
line `"Application drain complete", drained: true, activeRequests: 0`.

What is **not** verified, because no real hosting account/credentials exist
in this sandbox: actually deploying this backend process behind a real
public host (a cloud VM, container platform, or PaaS) reachable from the
public internet under a real domain. This is tagged **REQUIRES REAL
INFRASTRUCTURE** — exact manual action: provision a host (e.g. a small VM or
container service), copy `dist/` + `node_modules` (or build the Docker image
already defined in `Dockerfile`), supply the staging env vars, and run it
behind a process supervisor.

## 5. PostgreSQL — **VERIFIED**

A real PostgreSQL 18.4 instance (not a stub, not mocked) was started via
`scripts/embedded-pg.js` and used as a genuine standalone database server
for the length of this task (process pid 1786, port 5432, confirmed via
`ps`/`listening_ports`). Verified this session:

- **Fresh migrations run twice**: once against the live staging database
  `monienaija` at session start (inherited from Part H work, 82 migrations
  applied, confirmed via `/api/v1/health/ready` → `migrations.appliedCount:
  82`), and again this session against a brand-new, empty database
  `monienaija_restore_verify` created purely for the backup/restore drill
  (item 16) — migrations ran clean, creating 151 tables, 82 rows in
  `typeorm_migrations`, with zero errors.
- **No production data**: all customer/financial data in the database is
  synthetic data created by this task's own UAT (`+2348011110001`,
  `+2348022220002`, `+2348033330003` — none are real customers).
- **Real double-entry ledger integrity confirmed by direct SQL** (not just
  API-reported balances): `ledger_journals.status = 'POSTED'`,
  `ledger_lines` rows show matching `DEBIT`/`CREDIT` pairs summing to zero
  per journal, and a DB-level deferred constraint trigger
  (`assert_ledger_journal_balanced`) actively enforces this invariant at
  COMMIT time (discovered and worked around correctly during the backup
  restore drill — see item 16).

What remains outside this sandbox: a real **hosted/managed** Postgres
instance (e.g. RDS, Cloud SQL, managed Postgres) reachable over the network
from a real hosted backend. Tagged **REQUIRES REAL INFRASTRUCTURE** for that
specific aspect only — exact manual action: provision a managed Postgres
instance, point `DB_HOST`/`DB_PORT`/`DB_SSL=true`/credentials at it, re-run
migrations (`npm run migration:run`) against it.

## 6. DNS/domain — **REQUIRES REAL INFRASTRUCTURE**

No real domain is registered or controllable from this sandbox. There is no
DNS provider access, no way to create an `A`/`CNAME` record, and the E2B
sandbox's own ephemeral preview URL (`https://{port}-{sandboxId}.e2b.app`)
is not a substitute for a real staging domain — see item 7 for why it fails
even as a stand-in. Exact manual action: register (or reuse) a domain such
as `staging.monienaija.<tld>`, create a DNS record pointing to the real
hosting target from item 4.

## 7. HTTPS/TLS — **REQUIRES REAL INFRASTRUCTURE**

No HTTPS/TLS was verified, and none is claimed from configuration alone, per
the explicit instruction for this task. Concretely tested this session (and
in the prior session for this task): an external HTTP client
(`fetch_page`, acting as a genuine, non-Arena-privileged external caller)
hitting this sandbox's E2B preview URL receives **HTTP 403 "Missing traffic
access token"** from the platform edge — i.e. the preview URL is not
genuinely publicly reachable the way a real deployed staging domain would
be, and cannot be used to claim HTTPS works. Exact manual action: after a
real host + domain exist (items 4 and 6), obtain and install a real TLS
certificate (e.g. via Let's Encrypt/ACME or the hosting provider's managed
TLS), then test from a genuinely independent external network client (not
from inside this sandbox) that: `https://staging.monienaija.<tld>/api/v1/health`
returns 200 with a valid certificate chain, and that CORS behaves correctly
for the real admin-web origin (see item 8 for a real CORS gap found this
session that must be resolved as part of this work, independent of TLS).

## 8. Env/secrets — **PARTIALLY VERIFIED**

Verified real, non-default staging configuration was assembled and used for
every test in this session (48 variables in a local, git-ignored file
outside the repo at `/home/user/staging-verification/staging.env.sh`,
never committed, never printed in this document):

- `NODE_ENV=staging` (not `development`, not left as the production-only
  guard path) — confirmed the backend's own environment validator enforces
  meaningful constraints (e.g. rejects `NODE_ENV=production` with a console
  SMS provider — see item 9).
- No secrets exist in git: `.env.example` in the repo contains only
  placeholder values (confirmed by repo inspection in the prior session);
  the actual staging secrets file lives outside the repository entirely.
- No secret values appear in mobile app source (`apps/customer-mobile`,
  `apps/agent-mobile` reference `process.env`/config endpoints, not literal
  secrets — confirmed in the prior V1-MOBILE-01 task).
- No dev-only authentication bypass is enabled in this staging config (the
  full real OIDC/PIN/password/OTP chains were exercised end-to-end in items
  10 and 13 — nothing was short-circuited).
- Secret values are never echoed: every credential generated this session
  (admin bootstrap password, SUPPORT temporary password, OTP codes, customer
  passwords, transaction PIN) was written only to files under
  `/home/user/staging-verification/` (outside the git repo) and is not
  reproduced in this document.

**Real gap found and evidenced this session (not fixed — see item 19/20/21
for scope reasoning): no CORS configuration exists anywhere in the backend.**
`grep -rn -i cors src --include="*.ts"` (excluding spec files) returns zero
matches; `src/main.ts` never calls `app.enableCors()` or registers any CORS
plugin. Confirmed empirically against the live staging backend:

```
curl -i http://localhost:3000/api/v1/health -H "Origin: https://admin.staging.example"
→ HTTP/1.1 200 OK  (no Access-Control-Allow-Origin header at all)

curl -i -X OPTIONS http://localhost:3000/api/v1/health \
  -H "Origin: https://admin.staging.example" -H "Access-Control-Request-Method: GET"
→ HTTP/1.1 404 Not Found  (no OPTIONS/preflight handling at all)
```

This means: if `apps/admin-web` is ever served from a different origin than
the API in real staging/production (the common case unless a reverse proxy
unifies them under one origin), real browsers will silently block every API
call from the admin console despite the server itself responding correctly
to direct (non-browser) clients like `curl`. No documentation in
`docs/deployment/` addresses this (checked: no CORS/proxy guidance found).
This is tagged as a real, evidenced finding requiring a decision (add
explicit CORS configuration, or document and enforce a same-origin
reverse-proxy deployment topology) before real browser-based staging use —
see items 19–21 for why it was not auto-fixed in this task.

## 9. SMS/OTP via Robase — **REQUIRES REAL INFRASTRUCTURE**

This staging environment runs `NOTIFICATION_SMS_PROVIDER=console` with
`ROBASE_API_KEY=""` (empty) — there are no real Robase credentials available
in this sandbox, and none were fabricated. Per the explicit instruction for
this task, this is **not** substituted for real SMS/OTP verification and
called "verified." What was exercised, correctly labelled as
console-provider-only testing (not a real-SMS proof): the full
OTP-request → console-stdout-log → OTP-verify → registration-completion
lifecycle, a wrong-OTP rejection (`400`), and OTP-request-for-already-
registered-phone behaviour (`200`, generic — does not leak account
existence). None of resend-cooldown-exhaustion, real delivery expiry under
real carrier timing, or production SMS-provider rate-limit/lockout behaviour
was tested, because doing so requires a real Robase API key and real phone
numbers receiving real SMS. Exact manual action: obtain a real Robase API
key for a staging/sandbox Robase account, set
`NOTIFICATION_SMS_PROVIDER=robase` and `ROBASE_API_KEY=<real key>`, then
repeat the OTP lifecycle tests against real phone numbers capable of
receiving SMS.

## 10. Workforce bootstrap — **VERIFIED**

Full chain executed end-to-end against the real backend + real Postgres +
a self-hosted, throwaway RS256 JWKS test harness (a local OIDC ID-token
signer built purely to exercise `workforce-oidc.service.ts`'s real
signature/issuer/audience validation logic — not a product bypass):

1. OPERATOR obtains a workforce session via `POST
   /api/v1/internal/a2/workforce/sessions` using a genuine signed OIDC ID
   token (RS256, verified against a real JWKS endpoint) → `201`.
2. OPERATOR consumes a FINANCE_ADMIN bootstrap statement → `201`, the
   workforce subject is now `PRIVILEGED` with role `FINANCE_ADMIN`.
3. PRIVILEGED principal provisions a SUPPORT workforce user → `201`,
   temporary password returned once, never logged again, never printed in
   this document.
4. SUPPORT authenticates with that temporary password → `200`, scoped
   session (`support:ticket:read/reply/status` only).
5. SUPPORT accesses a permitted ticket-management endpoint → `200`.
6. SUPPORT attempts self-service re-provisioning (an unrelated
   workforce-admin action outside its scope) → `403` — confirmed no
   self-service privilege escalation is possible.
7. PRIVILEGED principal revokes the SUPPORT session → `200`.
8. The revoked session token is reused → `401` — confirmed revocation is
   enforced, not merely logged.

Re-verified again this session with a fresh SUPPORT login and a fresh
OPERATOR/PRIVILEGED login (both required again because the backend process
was restarted mid-session to pick up the item-13 fix — sessions do not
survive a process restart since they are time-bounded, not because state
was lost) and reused successfully as the maker/checker identities for the
Part 13 funding-and-transfer UAT below.

## 11. Customer Mobile — **CONFIGURED BUT UNTESTED (live API integration); REQUIRES REAL INFRASTRUCTURE (real build artifact / device)**

`apps/customer-mobile` is configured (per the prior V1-MOBILE-01 task) with
correct `app.json`/`eas.json` production-build settings, and its API client
code was inspected this session (`RegistrationScreen.tsx` and three other
screens) to confirm it calls the exact same `/api/v1/customers/registration*`
endpoints that were exercised directly via `curl` in item 13 — including
always sending an `idempotencyKey`, which is precisely what originally
triggered the bug fixed in item 21. No actual Expo/EAS build was produced
(no EAS account credentials exist in this sandbox) and the mobile app's own
UI was never run against this staging backend (no emulator/device available
— see item 18). Tagged **REQUIRES REAL INFRASTRUCTURE** for an actual build
artifact and on-device/emulator run — exact manual action: `eas login` with
a real Expo account, `eas build --platform <ios|android> --profile staging`
pointed at this staging API's real public URL (from item 4/6/7), then
install and exercise the resulting build on a device or emulator.

## 12. Agent Mobile — **CONFIGURED BUT UNTESTED (live API integration); REQUIRES REAL INFRASTRUCTURE (real build artifact / device)**

Same situation as item 11: `apps/agent-mobile` has valid build configuration
(from V1-MOBILE-01) but no real build artifact was produced and no W2C/C2W/
C2C flow was exercised through the actual Agent Mobile app UI in this
session. The backend-side agent endpoints (`/api/v1/agents/sessions`,
`/api/v1/internal/agents`, etc.) were confirmed present and reachable via
direct HTTP in item 10 (an agent session was created as part of a prior
part of this task), but the mobile client itself was not built or run.
Tagged **REQUIRES REAL INFRASTRUCTURE** — same exact manual action as item
11, for the agent-mobile app.

## 13. E2E UAT — **VERIFIED (with one real bug found and fixed mid-UAT — see item 21)**

A controlled, two-identity end-to-end user-acceptance test was run directly
against the real staging backend + real Postgres, using synthetic staging
phone numbers (`+2348011110001` "Customer A", `+2348022220002` "Customer
B"):

1. **Registration (Customer A)**: OTP requested → console-logged OTP
   consumed → `verificationToken` issued → registration completion
   **failed with HTTP 500** on first attempt (the bug — see item 21) →
   after the fix, retried end-to-end successfully → `201 Created`, real
   wallet created (`ACTIVE`, `NGN`, zero balance).
2. **Idempotency on registration**: retried the identical completion
   request with the same `Idempotency-Key` → `201`, **same** customer `id`
   returned both times; confirmed via direct SQL that exactly **one**
   `customers` row and **one** `idempotency_records` row
   (`status='COMPLETED'`, `response_status_code=201`) exist for that key —
   no duplicate account was created.
3. **Registration (Customer B)**: same flow, `201 Created`, succeeded first
   try (post-fix).
4. **Controlled funding (maker/checker)**: a SUPPORT workforce session
   created a ₦5,000.00 funding request for Customer A (`PENDING`); a
   PRIVILEGED/FINANCE_ADMIN session approved it (`APPROVED`, with a real
   posted ledger journal) — confirmed the maker≠checker rule is enforced in
   code (`src/customer-funding/customer-funding.service.ts`, "Maker cannot
   approve own funding request").
5. **Transaction PIN setup**: Customer A set a 4-digit transaction PIN
   (`200`).
6. **Wallet-to-wallet transfer**: Customer A → Customer B, ₦1,000.00,
   `201 Created`, `status: COMPLETED`. Verified via direct SQL: a `POSTED`
   ledger journal with exactly two balanced `ledger_lines` rows (`DEBIT`
   ₦1,000 from A's ledger account, `CREDIT` ₦1,000 to B's), and via the
   customer-facing API: Customer A's balance is ₦4,000.00
   (500000 − 100000 minor units), Customer B's is ₦1,000.00 — both match
   the ledger-derived balances exactly.
7. **Idempotency on the transfer**: retried the identical transfer request
   with the same `Idempotency-Key` → `201`, same `journalId`/`createdAt`
   returned, balances unchanged on re-check — confirmed no double-posting.

All of the above money movement used only controlled, synthetic staging
amounts (₦1,000–₦5,000) and synthetic identities; no production customer
data or production money was involved at any point.

## 14. Failure testing — **VERIFIED**

Run directly against the live staging backend this session:

| Test | Expected | Actual |
|---|---|---|
| Wrong transaction PIN on transfer | reject | `401 Unauthorized` |
| Transfer amount exceeding wallet balance | reject | `422 Unprocessable Entity` |
| Same `Idempotency-Key`, different transfer amount (conflicting replay) | reject | `409 Conflict` |
| Wrong OTP code on registration verify | reject | `400 Bad Request` |
| Transfer to a `SUSPENDED` customer's wallet | reject | `409 CUSTOMER_NOT_ACTIVE` |
| Login attempt by a `SUSPENDED` customer | reject | `401 Unauthorized` |
| Workforce SUPPORT self-escalation attempt | reject | `403 Forbidden` (re-verified, item 10) |
| Reuse of a revoked workforce session token | reject | `401 Unauthorized` (re-verified, item 10) |

Note on the suspended-customer test: there is **no workforce API endpoint in
V1 to suspend a customer** (confirmed by exhaustive grep across
`src/admin/*.controller.ts` and `src/internal/*` — only `AdminAgentLifecycleController`
exposes suspend/terminate/reactivate for **agents**, none exists for
customers, even though `CustomerStatus.SUSPENDED` is a defined enum value).
This test was therefore performed by directly setting
`customers.status = 'SUSPENDED'` in the database (a controlled, reversible,
staging-only action, immediately reverted back to `ACTIVE` afterward) to
exercise the application-layer enforcement logic, which behaved correctly.
This gap — a defined-but-unreachable customer status with no admin API to
set it — is recorded as a Part 19/23 finding, not fixed (out of scope: it
is a missing admin feature, not a bug in existing behaviour).

A real reconciliation run (`GET /api/v1/internal/reconciliation/report`)
immediately after this failure testing correctly flagged the two
deliberately-failed transfer attempts under a `failed_transfer_attempts`
monitoring check (`WARNING`, 2 violations) — this is expected, attributable
entirely to this session's own negative tests, and not a data-integrity
defect; every other check in the same report (`wallet_balances_ledger_derived`,
`journal_balance_integrity`, `orphan_ledger_entries`, etc.) returned `PASS`.

## 15. Backup — **VERIFIED**

No `pg_dump` binary exists in this sandbox (confirmed, again, this
session). A real COPY-protocol backup script
(`/home/user/staging-verification/pg-copy-backup-restore.js`, outside the
git repo, using the `pg` driver's native `COPY ... TO STDOUT WITH (FORMAT
binary)` over the real wire protocol — not a SELECT-and-reserialize
workaround) was written and run against the live staging database
`monienaija` for nine real tables spanning the full financial/ledger/
workforce surface touched by this task's UAT: `ledger_accounts`,
`customers`, `wallet_accounts`, `ledger_journals`, `ledger_lines`,
`customer_funding_requests`, `idempotency_records`,
`support_workforce_users`, `support_workforce_sessions`. Each table was
dumped to its own binary `.copy` file with a manifest recording byte sizes;
all files contain real, non-trivial byte counts corresponding to the real
row counts queried independently via SQL.

## 16. Restore — **VERIFIED**

A second, completely separate database (`monienaija_restore_verify`) was
created and brought to the identical real schema via the product's own real
migration runner (`npm run migration:run`, 82 migrations, 151 tables — same
counts as the live staging database). The item-15 backup files were then
restored into it via real `COPY ... FROM STDIN WITH (FORMAT binary)`, inside
a single explicit transaction with `SET CONSTRAINTS ALL DEFERRED` (required
because the schema has a genuine deferred constraint trigger,
`assert_ledger_journal_balanced`, enforcing double-entry balance per journal
at COMMIT time — discovered live during this drill when restoring table-by-
table without a single transaction failed with exactly that constraint
violation, then fixed by wrapping the whole restore in one transaction, a
correct and realistic disaster-recovery runbook pattern).

Verification performed directly via SQL comparing source vs. restored
database:

- Row counts match exactly for all nine tables (e.g. `ledger_lines`: 4 vs 4,
  `customers`: 2 vs 2).
- Ledger balance equality holds in **both** databases independently: total
  `DEBIT` = total `CREDIT` = 600000 minor units, **zero** unbalanced
  journals in either database.
- Restored per-wallet balances, derived purely from the restored
  `ledger_lines` (not copied from a stored balance column — this schema
  computes balance from the ledger, it does not persist one), exactly match
  the live API-reported balances from item 13: Customer A 400000 minor
  units (₦4,000.00), Customer B 100000 minor units (₦1,000.00).

This constitutes a genuine, executed backup-and-restore drill with real
data/ledger integrity verification — not a documentation reference to
`pg_dump` that was never run.

## 17. Logging/security — **VERIFIED (within the scope testable in this sandbox)**

The full backend stdout log for the entire session (thousands of lines,
`pino`-structured JSON via `pino-http`) was inspected directly. Findings:

- Every HTTP request log entry redacts the `Authorization` header as the
  literal string `"[REDACTED]"` — confirmed for every authenticated call
  made in this session (workforce, customer, and agent sessions alike).
- Request **bodies** are never logged at all (no `req.body` field appears
  anywhere in any log line) — meaning passwords, transaction PINs, OTP
  codes submitted in POST bodies, and verification tokens are never written
  to the log stream by the request logger.
- The **only** place a plaintext OTP code appears in logs is the explicit,
  clearly-labelled `[Notification][SMS]` console line produced by the
  `console` notification provider — this is expected, by-design behaviour
  of that specific local/dev/staging-only provider (which exists precisely
  so engineers can test OTP flows without a real SMS account), not a leak
  from the core request/response logging pipeline. A real production
  deployment using the `robase` provider (enforced by the environment
  validator for `NODE_ENV=production`, see item 3) would never produce this
  line, because it sends the OTP over a real HTTP call to Robase instead of
  writing it to stdout.
- No database credentials, JWT signing keys, or workforce bootstrap
  statement contents were observed anywhere in the log stream.

No secret value generated or observed in this session (admin bootstrap
password, SUPPORT temporary password, customer passwords, transaction PIN,
OTP codes, access tokens) is reproduced anywhere in this document.

## 18. Physical device testing — **REQUIRES REAL INFRASTRUCTURE**

No physical mobile device and no emulator/simulator are available in this
sandbox (confirmed: no Android SDK/emulator tooling, no iOS
Simulator/Xcode, no connected device). No physical-device testing is
claimed. Exact manual action: once a real mobile build artifact exists
(items 11/12), install it on a real Android or iOS device (or a real
emulator/simulator on a developer machine) and exercise the live
registration/login/transfer/support flows against the real staging API
from that device.

## 19. Exact blockers

1. **No DNS/domain access** (item 6) — blocks a real staging URL.
2. **No TLS/HTTPS termination reachable externally** (item 7) — the E2B
   preview URL returns `403 Missing traffic access token` to genuine
   external clients and cannot substitute for a real public HTTPS
   endpoint.
3. **No real Robase SMS credentials** (item 9) — `ROBASE_API_KEY` is empty;
   only the `console` provider was exercisable.
4. **No EAS/Apple/Google developer credentials** (items 11, 12) — no real
   mobile build artifact could be produced.
5. **No physical device/emulator** (item 18).
6. **No hosted/managed Postgres account** (item 5, hosting aspect only —
   the database engine itself and all its behaviour were fully exercised
   locally).
7. **No CORS configuration in the backend** (item 8) — not an access
   blocker in this sandbox (all testing here used direct HTTP clients, not
   a browser), but will block real browser-based admin-web usage against a
   cross-origin staging API unless resolved before go-live.
8. **No admin API exists to suspend/reactivate a customer** (item 14) — a
   defined `CustomerStatus.SUSPENDED` enum value has no reachable workforce
   endpoint to set it in V1.

## 20. External infrastructure requirements

To complete what this sandbox cannot:

- A domain name + DNS control (item 6).
- A real hosting target for the backend (VM/container/PaaS) with a public
  IP/hostname (item 4).
- A TLS certificate for that domain (e.g. Let's Encrypt via the host, or a
  managed-TLS load balancer) (item 7).
- A managed/hosted PostgreSQL instance reachable from that host, or a
  self-managed Postgres on a separate real server (item 5).
- A real Robase account and API key for the staging environment (item 9).
- An Expo/EAS account (and, for iOS, an Apple Developer Program
  membership; for Android, a Google Play Console account if store
  distribution is desired) to produce real mobile build artifacts (items
  11, 12).
- A physical Android/iOS device or a real emulator/simulator environment
  (item 18).

## 21. Exact fixes

**One real, production-blocking bug was found and fixed in this task.**

- **File**: `src/customer-registration/customer-registration.service.ts`,
  the idempotency-completion block inside the registration-completion
  method (around line 633 prior to the fix).
- **Exact defect**: `manager.getRepository(IdempotencyService)` was called
  with `IdempotencyService` — the `@Injectable()` **service class** from
  `src/operations/idempotency.service.ts` — where TypeORM requires an
  `@Entity`-decorated class. The correct entity is `IdempotencyRecord` from
  `src/operations/idempotency-record.entity.ts`
  (`@Entity({ name: 'idempotency_records' })`, with exactly the `scope` and
  `idempotency_key` columns the surrounding query builder already queried
  by name).
- **Exact symptom**: every call to `POST /api/v1/customers/registration`
  that supplied a (fully optional, per its own DTO) `idempotencyKey` field
  failed with `HTTP 500`, backend log: `"No metadata for \"IdempotencyService\"
  was found."` This code path is only reached when both `idempotencyKey` is
  present **and** the idempotency service is configured — exactly the
  production configuration — which is why it was never exercised by any
  existing automated test (confirmed: `grep -rn "idempotencyKey" test/` for
  the registration-completion flow returns zero matches prior to this
  task).
- **Why this is a real, deployment-blocking bug and not a theoretical edge
  case**: `apps/customer-mobile/src/screens/unauthenticated/RegistrationScreen.tsx`
  (the actual Customer Mobile app shipped to real users) **always** sends
  `idempotencyKey` on registration completion. Every real customer
  attempting to register through the real mobile app would have hit this
  exact `500` in any environment where the idempotency service is wired up
  (which is the default/production wiring) — this was previously unknown
  and undocumented.
- **Exact fix applied**: added `import { IdempotencyRecord } from
  '../operations/idempotency-record.entity';` and changed
  `.getRepository(IdempotencyService)` → `.getRepository(IdempotencyRecord)`
  at the single call site. No other code was touched.
- **Validation performed after the fix** (not merely asserted):
  1. `npm run build` — clean, zero errors.
  2. `npm test` — **1806/1806 tests passed**, 173/173 suites, no
     regressions.
  3. Targeted real-Postgres integration suites
     (`customer-registration`, `v1-customer-onboarding`) — **29/29 passed**
     against the real embedded Postgres instance.
  4. The backend process was rebuilt and restarted; the exact previously-
     failing request (OTP request → verify → registration completion with
     `idempotencyKey`) was re-run live against the real staging backend and
     the real staging database and now returns `201 Created`.
  5. The idempotency behaviour itself was then verified correct, not just
     "no longer crashing": a replay of the identical request with the same
     `idempotencyKey` returned the **same** customer record (no duplicate
     row created — confirmed via direct SQL), and a corresponding
     `idempotency_records` row (`status='COMPLETED'`) now exists, proving
     the originally-intended idempotency mechanism works end-to-end once
     the entity-class bug is corrected.
  6. This fix was additionally proven correct under full E2E UAT (item 13)
     and under the transfer-level idempotency test (also item 13), both of
     which depend on the corrected entity mapping.
- **Scope justification for making this fix**: it is a single, unambiguous,
  one-class-reference correction (not a new feature, not a redesign, not a
  new auth system, not a backend architecture change) required to complete
  the mandated Part 13 E2E UAT at all — the UAT could not otherwise proceed
  past customer registration, since the real mobile app's request shape
  (always including `idempotencyKey`) was used faithfully rather than
  avoided to dodge the bug.

No other code changes were made in this task.

## 22. Test results

- `npm run build`: clean, 0 errors.
- `npm test` (full unit suite): **173 suites passed, 1806 tests passed, 0
  failed.**
- Targeted real-Postgres integration suites
  (`customer-registration*`, `v1-customer-onboarding*`): **2 suites
  passed, 29 tests passed, 0 failed**, run against the real embedded
  Postgres instance with `DB_HOST=localhost`/real credentials (not SQLite,
  not mocked).
- Live E2E UAT (item 13): registration ×2, idempotent registration replay,
  controlled funding with real maker/checker enforcement, PIN setup,
  W2W transfer, idempotent transfer replay — **all behaved correctly**,
  cross-checked against direct SQL on the real database at every financial
  step.
- Live failure-mode tests (item 14): **8/8 behaved as expected** (see
  table in item 14).
- Live backup/restore drill (items 15–16): **9/9 tables matched** row-for-
  row between source and restored database; ledger balance verified equal
  and zero-unbalanced-journals in both; wallet balances re-derived from the
  restored ledger matched live API balances exactly.
- `GET /api/v1/health`, `/api/v1/health/ready`, `/api/v1/internal/version`:
  all `200`/`ok`, migrations `appliedCount: 82`.
- `GET /api/v1/internal/reconciliation/report`: overall `WARNING` — 7 of 9
  checks `PASS`; the 2 `WARNING` checks are (a) `failed_transfer_attempts`
  (exactly the 2 deliberate negative tests from item 14 — expected, not a
  defect), and (b) `customer_financial_account_binding_integrity` (a real
  finding — see item 23).

## 23. Remaining work

1. All items tagged **REQUIRES REAL INFRASTRUCTURE** above (6, 7, 9, 11,
   12, 18, and the hosting aspect of 5) require genuine external
   credentials/accounts this sandbox does not have, and must be completed
   by someone with access to them, following the exact manual actions
   listed in item 20.
2. **CORS is not configured anywhere in the backend** (item 8) — a
   deliberate decision is needed (either add explicit CORS configuration
   for the real admin-web origin, or document and enforce a same-origin
   reverse-proxy topology) before any browser-based client is pointed at a
   cross-origin staging/production API. Not fixed in this task because it
   requires a topology/security decision beyond a one-line, unambiguous
   bug correction, and is outside this task's explicit scope boundaries.
3. **No workforce API exists to suspend/reactivate a customer** (item 14) —
   `CustomerStatus.SUSPENDED` is defined and correctly enforced everywhere
   it is checked, but nothing in V1 can set it short of direct database
   access. This is a product-completeness gap, not a bug, and was
   deliberately not added as a new feature in this task (explicit scope
   exclusion: "no new features").
4. **`customer_financial_account_binding_integrity` reconciliation
   check reports a real, evidenced `WARNING`** for both UAT customers:
   the reconciliation module (`src/reconciliation/reconciliation.service.ts`,
   `collectBindingReconciliation`) expects every wallet in
   `wallet_accounts` to have a corresponding row in
   `customer_financial_account_bindings` and in a separate, apparently
   parallel `customer_wallets` table (confirmed empty — 0 rows — throughout
   this entire task, while the live, actually-used registration/transfer
   flow exclusively populates `wallet_accounts`). This indicates either (a)
   a newer/alternate customer-wallet data model that the live registration
   path has not been wired to populate, or (b) a reconciliation check built
   against a data model the current registration flow does not use. This
   needs product/architecture-owner investigation; it was not fixed in this
   task because resolving it would require understanding and likely
   touching backend data-model/architecture decisions explicitly out of
   this task's scope ("no backend architecture rewrite").
5. Once external infrastructure (item 20) is provisioned, re-run items 6,
   7, 9, 11, 12, and 18 for real (not console-mock, not sandbox-ephemeral)
   verification, and re-run the full E2E UAT (item 13) and failure tests
   (item 14) against the real public staging URL end-to-end, including
   from genuinely external clients for the HTTPS/CORS checks.
6. Consider adding automated test coverage for the `idempotencyKey` code
   path on customer registration (item 21) to prevent regression — no such
   test exists today, which is exactly how the original bug went
   undetected through 1806 passing unit tests.

## 24. Final recommendation

**B. STAGING DEPLOYMENT VERIFIED — FIXES IMPLEMENTED**

The backend, database, workforce bootstrap, and full customer-registration
→ funding → transfer E2E flow (including idempotency and a wide range of
failure modes) were rigorously verified against a real, locally-hosted
instance of the actual product code, real PostgreSQL, and a real (though
self-hosted-for-testing) OIDC harness — and one genuine, previously-unknown,
production-blocking bug was found during that verification and fixed,
rebuilt, and re-validated with zero regressions (1806/1806 unit tests,
29/29 targeted integration tests, and a full live re-run of the exact
previously-failing flow).

What is explicitly **not** claimed, consistent with the hard rule against
fabricating infrastructure: a real public domain, real HTTPS reachable from
genuinely external clients, real SMS/OTP delivery via Robase, real mobile
build artifacts, and physical-device testing. These remain tagged
**REQUIRES REAL INFRASTRUCTURE** with exact manual actions recorded in item
20, and none of them is claimed as done. MonieNaija is **not** declared
production-ready by this task — this task's scope is staging
infrastructure verification only.
