# V1-ADMIN-LOCAL-LOGIN-01 — Local Developer Login for Admin Web

**Audience:** engineers running Admin Web (`apps/admin-web`) against a local backend for
development only.
**Status:** LOCAL DEVELOPMENT ONLY. This entire mechanism is independently disabled in
production by three separate gates (see "How production is protected" below). It is not a
production authentication path and must never be treated as one.
**Companion files:**
- `docs/deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md` — the REAL, audited production/
  staging bootstrap ceremony for the first `FINANCE_ADMIN` (external OIDC + MFA). Use that
  runbook for any non-local environment.
- `scripts/local-dev-seed-admin.js` — the seed script this document describes.
- `src/local-admin-authentication/` — the backend module implementing this path.

---

## 1. Why this exists

Admin Web's real, production login path is an external OIDC exchange
(`POST /internal/a2/workforce/sessions` with a signed OIDC ID token) plus MFA, as required by
`A2WorkforceOidcService`. Standing up a real OIDC identity provider just to click around
Admin Web on a laptop is disproportionate. Before this change, local development instead
showed a developer-facing "Sandbox Development Mode" screen with a prefilled
`mock-sandbox-token-ADMIN` value and an "Autofill Sandbox Token" button — a confusing,
non-conventional login UX with no real username/password, and the OIDC/bootstrap token
fields visible by default even though almost no one needs them for ordinary local use.

This feature replaces that default view with an ordinary **email + password + Sign In**
form that authenticates against the real backend and establishes a real, fully-authorized
A2 workforce session — the same kind of session every other workforce login path produces.
The OIDC/Bootstrap panel still exists, for the rare case an engineer needs to exercise that
path directly, but it is now hidden behind a collapsed **"▼ Advanced: OIDC / Bootstrap
(engineering only)"** disclosure and is never prefilled with a token.

## 2. Exact local administrator credentials

```
Email:    admin@monienaija.local
Password: MonieNaijaAdmin123!
```

These are **LOCAL DEVELOPMENT ONLY** values, hardcoded as defaults in
`scripts/local-dev-seed-admin.js`. They are not secrets worth protecting outside a local
database — they are deliberately well-known so every engineer's local environment behaves
identically. **Never create or accept this credential outside local development** (see
below for how that is enforced, not just conventionally assumed).

## 3. How to create the default local administrator

The role granted matches the real V1 finance-administrator role — this does **not** invent a
new role. **(Updated by V1-ADMIN-UAT-IDENTITY-01 — see
`docs/V1/V1-ADMIN-UAT-IDENTITY-01-REPORT.md` for the full before/after investigation.)** The
seed step grants the administrator exactly **one** role, `FINANCE_ADMIN`, through a REAL,
persisted `a2_finance_role_assignments` row — scope `privileged:execute` — keyed to a
principalId deterministically derived from the credential's own email
(`https://local-dev-identity.monienaija.invalid:local-admin-credential:<sha256(email)>`). This
is the exact same per-principal role-assignment table and lookup every other workforce
principal's authorization already goes through (`A2WorkforceSessionService.resolve()`), not a
blanket grant of every role enabled in `.env` and not the shared, non-identity-specific
`mock-sandbox-subject` principal. Additional roles (`FINANCE_PREPARER`, `FINANCE_CONTROLLER`,
`FINANCE_AUDITOR`) are intentionally **not** granted to this account — the real V1 design
reserves those for separate maker/checker principals, and FINANCE_ADMIN alone already satisfies
every Admin Web screen's authorization requirement (`type: PRIVILEGED`, no endpoint in this
codebase currently requires `finance:audit`/`finance:prepare`/`privileged:approve` at the route
level).

```bash
# from the repository root, after `npm run build` and `npm run migration:run`
NODE_ENV=development node scripts/local-dev-seed-admin.js

# optional: a different local email/password
NODE_ENV=development node scripts/local-dev-seed-admin.js you@example.local YourLocalPass123!
```

The script never logs the password. It prints:

```json
{
  "status": "DEVELOPMENT ONLY — local database only, never run against production",
  "email": "admin@monienaija.local",
  "created": true,
  "note": "Local administrator credential created.",
  "loginUrl": "http://localhost:5173",
  "backendLoginEndpoint": "POST http://localhost:3000/api/v1/internal/a2/workforce/local-admin-sessions"
}
```

### Idempotency

Re-running the script for the same email makes **no change** — it reports
`"created": false` and the existing credential (and its password) is left untouched. This is
backed by a unique index on `local_admin_credentials.email` plus an explicit existence
check, mirroring the idempotency convention already used by
`SupportAuthenticationService.provision()` elsewhere in this codebase.

### How to reset/recreate

There is no "update password" operation by design (this is a disposable local fixture, not
an account management surface). To reset:

```sql
-- against your local database only
DELETE FROM local_admin_credentials WHERE email = 'admin@monienaija.local';
```

then re-run the seed script. Running it with a different password for the same email while
the row still exists has **no effect** — delete the row first.

## 4. How Admin Web is started and connects to the local backend

```bash
# Terminal 1 — backend (repository root)
npm run build
npm run migration:run
node dist/main.js            # listens on http://localhost:3000

# Terminal 2 — seed the local administrator once
NODE_ENV=development node scripts/local-dev-seed-admin.js

# Terminal 3 — Admin Web
cd apps/admin-web
npm run dev                  # Vite dev server on http://localhost:5173
```

Open **http://localhost:5173**, enter `admin@monienaija.local` / `MonieNaijaAdmin123!`, and
click **Sign In**.

### The "Failed to fetch" root cause (fixed)

The backend and the Admin Web dev server are different origins
(`http://localhost:3000` vs `http://localhost:5173`), and the backend's `main.ts`
deliberately never calls `app.enableCors()` (production fronts both behind a single
reverse-proxy origin — see `src/config/index.ts`). A browser `fetch()` straight from 5173 to
3000 is therefore a genuine cross-origin request with no CORS headers on the response, which
the browser blocks before Admin Web ever sees a real HTTP status — surfacing only as the
generic `TypeError: Failed to fetch`.

The fix (`apps/admin-web/vite.config.ts`) proxies `/api/*` from the Vite dev server to the
real backend (`http://localhost:3000` by default, overridable via
`ADMIN_WEB_DEV_PROXY_TARGET`), and `apps/admin-web/src/config/index.ts` now defaults
`API_BASE_URL` to the same-origin-relative `/api/v1` instead of an absolute
`http://localhost:3000/api/v1`. The browser only ever talks to its own origin — exactly the
"deployed behind one reverse-proxy origin" model production uses. No backend CORS
configuration was added or is needed.

## 5. Exact backend endpoint and session mechanism

- **Endpoint:** `POST /api/v1/internal/a2/workforce/local-admin-sessions`
  (`src/local-admin-authentication/local-admin-authentication.controller.ts`), registered
  next to the real OIDC exchange `POST /api/v1/internal/a2/workforce/sessions` and governed
  by the identical route-policy authentication mode
  (`WORKFORCE_ASSERTION` — unauthenticated, rate-limited, hard-dependent on
  `A2_WORKFORCE_ENABLED=true`; see `src/authorization/route-policy-registry.ts`).
- **Credential check:** PBKDF2 (10,000 iterations, per-row random salt, constant-time
  compare) against `local_admin_credentials`, mirroring the hashing convention used
  elsewhere in this codebase (e.g. `A7AgentAuthenticationCredential`). Unknown email and
  wrong password both perform a real PBKDF2 computation and return the identical
  `401 Invalid local administrator credentials` — timing/response are not distinguishable.
- **Session issuance:** a verified password check never mints a session itself. It instead
  builds an `A2WorkforceAssertionEvidenceV1` directly — with a subject/principalId
  deterministically derived from the verified credential's own email, NOT the shared
  `mock-sandbox-subject` literal `A2WorkforceOidcService`'s sandbox bypass produces — and
  exchanges it through the existing `A2WorkforceSessionService.establish()` — the exact same
  session/authorization/audit infrastructure every other workforce login in this codebase uses
  (see `docs/V1/V1-ADMIN-UAT-IDENTITY-01-REPORT.md`). The response shape is
  the real `A2WorkforceSessionTokenV1` (`accessToken`, `tokenType: "Bearer"`, `sessionId`,
  `expiresAt`, `principal.{type, roles, scopes, assuranceLevel, ...}`), honoring the
  configured session TTL (`A2_WORKFORCE_SESSION_TTL_SECONDS`).
- **Everything downstream is unchanged:** the issued token is validated by the same
  `A2WorkforceSessionService`/`RuntimeAccessGuard` every other workforce-authenticated
  endpoint already uses, audited through the same `audit_events` table
  (`A2_WORKFORCE_SESSION` / `WORKFORCE_SESSION_ESTABLISHED`), and subject to the same
  maker-checker, rate-limit, and scope-based authorization rules as a real OIDC login.
  Admin Web persists the token to `localStorage` (`admin_workforce_token`) exactly as it
  already did for the OIDC path, and attaches it as `Authorization: Bearer <token>` on every
  subsequent API call via `ApiClient`.

## 6. How production is protected from this local credential

Three independent gates must all agree before this path can ever issue a session. Any one
of them alone is sufficient:

1. **`LocalAdminAuthenticationService.login()`** throws `NotFoundException` (the route
   behaves as if it does not exist — a plain 404, not a 401) unless
   `NODE_ENV=development` or `NODE_ENV=test`.
2. **`LocalAdminAuthenticationService.seedDefaultAdmin()`** throws before touching the
   database unless `NODE_ENV=development` or `NODE_ENV=test` — a production deployment
   running the seed script by mistake fails loudly instead of creating a credential.
3. **`LocalAdminAuthenticationService.login()`** independently refuses unless
   `A2_WORKFORCE_ENABLED=true`, and **`A2FinanceRoleAdministrationService.grantLocalAdministratorFinanceAdmin()`**
   independently re-checks `NODE_ENV=development/test` before writing the FINANCE_ADMIN
   role-assignment row.

(As of V1-ADMIN-UAT-IDENTITY-01, this path no longer calls `A2WorkforceOidcService.validate()`
or its `mock-sandbox-token-*` sandbox bypass at all — that service and its bypass remain fully
intact for the automated tests that still use them directly, but the local administrator's own
authorization no longer depends on them in any way. See
`docs/V1/V1-ADMIN-UAT-IDENTITY-01-REPORT.md`.)

A production (or staging) deployment fails at gate 1 before ever touching the credential
table, the OIDC service, or the session service — proven in
`test/v1-admin-local-login-01.integration.spec.ts` ("F"/"F2") against a real PostgreSQL
database with `NODE_ENV=production` set.

Additional hygiene: the password is never logged (the seed script only ever prints the
email and a boolean); `local_admin_credentials` is a schema-only table in any environment
that never runs the seed script or the login route (a migrated production database simply
has it permanently empty); no real secret is committed anywhere in this repository.

## 7. Automated test coverage

| Deliverable item | Where it is proven |
|---|---|
| A. deterministic seed creates exactly one admin | `test/v1-admin-local-login-01.spec.ts` ("A"), `test/v1-admin-local-login-01.integration.spec.ts` ("A", real PostgreSQL) |
| B. repeated seed is idempotent | `.spec.ts` ("B", "B2"), `.integration.spec.ts` ("B", real PostgreSQL) |
| C. correct credentials authenticate | `.spec.ts` ("C"), `.integration.spec.ts` ("C", real HTTP against the real backend) |
| D. wrong password / unknown email rejected (401) | `.spec.ts` ("D", "D2"), `.integration.spec.ts` ("D", "D2", real HTTP) |
| E. authenticated admin receives a valid workforce session | `.integration.spec.ts` ("E" — the issued token is used live against a real protected admin endpoint and succeeds; absence of a token is rejected) |
| F. production mode refuses the local credential | `.spec.ts` ("F", "F2" — service-level, mocked), `.integration.spec.ts` ("F", "F2" — real PostgreSQL + real HTTP with `NODE_ENV=production`) |
| G. Admin Web login integration reaches the real backend auth path | `apps/admin-web/__tests__/app.test.tsx` (Sign In posts to `/internal/a2/workforce/local-admin-sessions` and loads the dashboard on success; 401 shows an inline error), `apps/admin-web/__tests__/auth-store.test.ts` (`loginWithPassword` success/failure) |
| H. existing mock/sandbox auth still works where genuinely still needed | `apps/admin-web/__tests__/app.test.tsx` (the collapsed Advanced/OIDC panel still renders and is reachable), `apps/admin-web/__tests__/auth-store.test.ts` (`login()` / OIDC path never fabricates a client-side session on failure) |

Run them with:

```bash
npm test                                                  # backend unit suite
npx jest -c jest.integration.config.js \
  test/v1-admin-local-login-01.integration.spec.ts         # backend PostgreSQL + HTTP suite
cd apps/admin-web && npm test                              # Admin Web suite
```
