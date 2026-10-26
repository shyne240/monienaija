# V1-ADMIN-UAT-IDENTITY-01 — Real Persisted Authorization Identity for `admin@monienaija.local`

**Scope note (explicit, per request): this closes the specific gap identified in
`V1-ADMIN-UAT-READINESS-01-REPORT.md` (commit `0f7d1a6`) — the default local
administrator's authorization was a blanket, config-driven grant tied to the
shared `mock-sandbox-subject` identity, not a real per-principal row. This task
gives `admin@monienaija.local` its own real, persisted `A2FinanceRoleAssignment`
row (`FINANCE_ADMIN` only), decoupled from the shared sandbox-bypass identity.
It is NOT a new authentication system and does NOT change how any other
workforce principal authenticates or is authorized.**

---

## 1. What was wrong (before this task)

Confirmed directly against the database in the prior task's report: the
local-admin login path always resolved to the fixed principal
`https://local-dev-identity.monienaija.invalid:mock-sandbox-subject`, and
`A2WorkforceSessionService.resolve()` special-cased that exact subject to
return **every `enabled: true` role** from `A2_FINANCE_ROLES_JSON`
(`FINANCE_ADMIN`, `FINANCE_AUDITOR`, `FINANCE_CONTROLLER`, `FINANCE_PREPARER`)
without ever consulting `a2_finance_role_assignments`. A live query at the time
confirmed **zero** rows in that table for `mock-sandbox-subject`. The
administrator's authorization was therefore not a persisted, auditable,
per-identity grant — it was a shared dev-mode bypass that happened to be
reached via the local-admin credential.

## 2. What changed (code)

- **`src/authorization/finance-role-administration.service.ts`** — added
  `grantLocalAdministratorFinanceAdmin(principalId, assignedBy, now)`: a
  narrowly-scoped, `NODE_ENV=development|test`-gated method that creates a
  real `A2FinanceRoleAssignment` row (status `ACTIVE`, role `FINANCE_ADMIN`,
  scopes from the live role config) through the exact same persistence,
  reference-derivation, and audit-trail infrastructure every other role grant
  in the codebase uses. Idempotent per `principalId` (a second call for the
  same principal returns the existing row, never a duplicate). This is
  explicitly **not** the production bootstrap ceremony (`consumeBootstrap()`,
  which requires an externally-signed JWS and is untouched by this change).
- **`src/local-admin-authentication/local-admin-authentication.service.ts`**
  — `login()` no longer calls `A2WorkforceOidcService.validate()` (the
  shared sandbox-bypass path). It now hand-builds the assertion evidence with
  a **deterministic principalId derived from the credential's own email**
  (`issuer:local-admin-credential:sha256(email).slice(0,32)`), so the admin's
  session principal is unique to that credential, not shared with any other
  sandbox identity. The constructor dependency on `A2WorkforceOidcService` was
  removed entirely (no runtime path from local-admin login to the OIDC
  service remains). `seedDefaultAdmin()` now unconditionally calls
  `grantLocalAdministratorFinanceAdmin` for that deterministic principalId and
  returns `{ created, email, role: { principalId, roleKey, assignmentReference,
  status } }`.
- **`scripts/local-dev-seed-admin.js`** — doc comment and console output
  updated to describe the real persisted grant (removed the previous,
  now-inaccurate "every enabled role" description) and to print the resulting
  `role` object.
- **`docs/V1/V1-ADMIN-LOCAL-LOGIN-01.md`** — role-grant, session-issuance, and
  production-safety-gate sections rewritten to describe the real per-principal
  assignment and the two independent `NODE_ENV` gates (service-level and
  role-grant-method-level) instead of the old OIDC-bypass description.

## 3. Test coverage added

- **Unit suite (`test/v1-admin-local-login-01.spec.ts`)**: updated for the new
  constructor signature (no `A2WorkforceOidcService`) and new
  `seedDefaultAdmin()` return shape. **14/14 passing.**
- **Integration suite (`test/v1-admin-local-login-01.integration.spec.ts`,
  real PostgreSQL + real HTTP)**: 8 pre-existing tests (A–F2) plus 5 new tests
  added this task:
  - **I1** — seeding creates exactly one real, persisted `ACTIVE`
    `FINANCE_ADMIN` row in `a2_finance_role_assignments`, keyed to a
    `principalId` that excludes `mock-sandbox-subject`.
  - **I2** — seeding twice is idempotent at the role-assignment level (same
    `assignmentReference`, row count stays 1).
  - **I3** — the authenticated session's principal/roles, and the
    corresponding `a2_workforce_sessions` DB row, resolve through the normal
    per-principal role-assignment lookup — roles are strictly `['FINANCE_ADMIN']`,
    not all four.
  - **I4** — `A2WorkforceOidcService.validate()` is never invoked during the
    local-admin login HTTP round-trip (direct proof via `jest.spyOn`).
  - **I5** — logout/revocation and re-login both work against the new
    identity, with a distinct new session ID on re-login.
  - **Result: 13/13 passing** (full suite, including all pre-existing tests).
- **Full backend regression (`npm test`)**: 174 suites / 1823 tests, 0
  regressions.
- **`tsc --noEmit`**: clean.
- **Admin-web (`apps/admin-web`) Jest suite**: 6/6 suites, 27/27 tests passing
  — unaffected, since all role/scope references in admin-web tests are
  self-contained mock fixtures independent of the real backend seed path.

## 4. Live verification — the required 8-step sequence (re-run against a built `dist/main.js`, real embedded Postgres)

| Step | Action | Result |
|---|---|---|
| 1 | Seed default admin | `created: true`, `role.principalId = https://local-dev-identity.monienaija.invalid:local-admin-credential:882fb3c173fcbd58cf1bca953634e15f`, `role.roleKey = FINANCE_ADMIN`, `role.status = ACTIVE` |
| 2 | Seed again | `created: false`; **identical** `principalId` and `assignmentReference` as step 1 (deterministic + idempotent) |
| 3 | Confirm exactly one credential + one role row | `local_admin_credentials` → **1 row**; `a2_finance_role_assignments` → **1 row**, `role_key=FINANCE_ADMIN`, `status=ACTIVE`, `scopes=["privileged:execute"]` |
| 4 | Login with documented password | `POST /api/v1/internal/a2/workforce/local-admin-sessions` with `MonieNaijaAdmin123!` → HTTP 201; `principal.principalId` matches the seeded value; `principal.roles = ["FINANCE_ADMIN"]` (not all four); wrong password → HTTP 401 |
| 5 | Confirm authenticated session | Issued token against `GET /api/v1/internal/customers` → HTTP 200; no token → HTTP 401 |
| 6 | Confirm persisted authorization identity | `a2_workforce_sessions` row for the session ID has `principal_id`/`subject`/`roles` matching the login response exactly; a live query of `a2_finance_role_assignments` by that exact `principal_id` returns **1** row; a repo-wide check confirms **0** rows anywhere reference `mock-sandbox-subject` |
| 7 | Confirm logout/revocation | `DELETE /api/v1/internal/a2/workforce/sessions/:id` with `{"reason": "..."}` → HTTP 200; DB row flips to `status: REVOKED`; the revoked token then gets HTTP 401 on the same protected endpoint |
| 8 | Confirm re-login | New login succeeds, issues a **new, distinct** `sessionId`, still resolving to exactly `["FINANCE_ADMIN"]`, and the new token works against the protected endpoint |

### Exact persisted `a2_finance_role_assignments` row (step 3/6, verbatim)

```json
{
  "principal_id": "https://local-dev-identity.monienaija.invalid:local-admin-credential:882fb3c173fcbd58cf1bca953634e15f",
  "role_key": "FINANCE_ADMIN",
  "scopes": ["privileged:execute"],
  "status": "ACTIVE",
  "assigned_by": "local-dev-seed-admin-script"
}
```

This directly supersedes the OLD row recorded in the prior report, which was:

```json
{
  "principal_id": "https://local-dev-identity.monienaija.invalid:mock-sandbox-subject",
  "subject": "mock-sandbox-subject",
  "roles": ["FINANCE_ADMIN", "FINANCE_AUDITOR", "FINANCE_CONTROLLER", "FINANCE_PREPARER"],
  "scopes": ["finance:audit", "finance:prepare", "privileged:approve", "privileged:execute"]
}
```

A live check this turn (`SELECT count(*) FROM a2_finance_role_assignments WHERE
principal_id LIKE '%mock-sandbox-subject%'`) returned **0** — the shared
sandbox identity is no longer part of the admin's authorization chain at all.

## 5. Production-safety gates — re-verified live

Two **independent** gates were confirmed, not just one:

- `LocalAdminAuthenticationService.seedDefaultAdmin()` (and therefore the
  seed script) refuses outside `NODE_ENV=development|test` — confirmed by
  integration test F and by a direct `NODE_ENV=production node
  scripts/local-dev-seed-admin.js` run this turn, which failed
  (`process.exit(1)`, no credential or role row created).
- The login route itself returns 404 under `NODE_ENV=production` even with a
  seeded row — confirmed by integration test F2.
- **New this task:** `A2FinanceRoleAdministrationService.grantLocalAdministratorFinanceAdmin()`
  has its **own independent** `NODE_ENV` check, redundant with (not relying
  on) the service-level gate above. This was verified live by calling the
  method directly (bypassing `seedDefaultAdmin`'s own earlier guard) while
  temporarily flipping `process.env.NODE_ENV = 'production'` on an
  already-bootstrapped app context: the call threw
  `"grantLocalAdministratorFinanceAdmin refuses to run outside
  NODE_ENV=development or NODE_ENV=test"`, exactly as designed, and succeeded
  once `NODE_ENV` was restored to `test`. (Note: a full fresh process-level
  `NODE_ENV=production` boot of the whole app fails even earlier, for an
  unrelated reason — `NOTIFICATION_SMS_PROVIDER` must be `robase` in
  production — which is expected, pre-existing, and orthogonal to this
  task's gates; it does not substitute for the targeted check above, which is
  why the targeted check was performed in isolation.)
- The leftover test-principal row created during this isolated gate check was
  deleted immediately afterward; the database was re-confirmed to contain
  exactly the one real `admin@monienaija.local` `FINANCE_ADMIN` row before
  moving on.

## 6. Validation-type discipline (explicit requirement)

- **Automated HTTP validation:** steps 1–8 above — real `curl` calls against
  a built `dist/main.js` NestJS process (port 3000) and direct SQL queries
  against a live embedded Postgres instance. Real, end-to-end, not mocked.
- **Automated integration testing:** `jest -c jest.integration.config.js`
  against the same kind of real Postgres + real HTTP stack, in-process
  (`supertest`) — 13/13 passing, including the 5 new identity-specific tests.
- **Unit/component testing:** backend unit suite (174/174 suites) and
  admin-web Jest/Testing-Library suite (6/6 suites) — both jsdom/mocked, not
  a real browser.
- **Actual browser/manual validation: NOT performed.** This sandbox has no
  Chromium/Playwright/Puppeteer, as already established in the prior two
  tasks. **This report is UAT-readiness / backend-identity verification only
  — it does not constitute, and must not be read as, a complete Admin Web
  browser UAT.**

## 7. Was a code/behavior change necessary?

**Yes.** The admin's authorization now comes from a real, persisted,
auditable `a2_finance_role_assignments` row keyed to a principal unique to
that credential (`FINANCE_ADMIN` only — not all four roles), instead of a
shared, config-driven, `mock-sandbox-subject` bypass grant. No other
authentication path, login system, or production authorization flow was
touched.

## 8. Commit hash

See the commit immediately following this report's addition on
`arena/01a10374-monienaija` (message references `V1-ADMIN-UAT-IDENTITY-01`).

---

**This is a backend authorization-identity verification and fix. It is not a
full Admin Web UAT. No browser-based validation was performed or claimed.**
