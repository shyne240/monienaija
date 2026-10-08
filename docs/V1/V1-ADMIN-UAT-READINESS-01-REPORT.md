# V1-ADMIN-UAT-READINESS-01 — Admin Web UAT-Readiness Verification

**Scope note (explicit, per request): this is a focused UAT-readiness verification of
the two acceptance questions below, run against the actual current `HEAD`
(`8c6d862`, previously `dfb261e`). It is NOT a full Admin Web UAT and NOT a
redesign of authentication. No new login system was created; no existing
authentication architecture was changed.**

---

## Question 1 — Approved MonieNaija branding

### What was found (before any fix)

Tracing the actual rendering code path (not assuming correctness because an
asset file exists in the repo):

- **Login page (`apps/admin-web/src/screens/unauthenticated/LoginScreen.tsx`,
  line 74):** rendered `<span style={styles.logoIcon}>₦</span>` — a plain
  Unicode "₦" **text character**, styled via CSS as a gold-on-green circle
  (`#FFB703` on `#0A3D25`, 72px). **No image asset was involved at all.** This
  is exactly the "generic green/gold ₦ logo" you described.
- **Post-authentication sidebar (`apps/admin-web/src/screens/authenticated/Layout.tsx`,
  line 26):** same pattern — `<span style={styles.brandIcon}>₦</span>`,
  green-on-gold circle (`#0A3D25` on `#FFB703`, 36px). Also no image.
- **Favicon (`apps/admin-web/index.html`):** correctly wired —
  `<link rel="icon" type="image/png" href="/favicon.png" />`, pointing at
  `apps/admin-web/public/favicon.png`, which **is** the approved logo asset
  (confirmed visually: the green/gold "M" ribbon mark). This part was already
  correct.
- **Root cause:** commit `2a05c62` ("feat(branding): apply approved MonieNaija
  logo assets") only added the admin-web **favicon** — it never touched
  `LoginScreen.tsx` or `Layout.tsx`. The text-glyph badges predate that commit
  and were simply never replaced. This was not "the wrong asset got selected"
  — it was "no asset was ever wired into these two components."
- No stale/duplicate logo files were found: `apps/admin-web/public/` contains
  exactly one file (`favicon.png`), no leftover default Vite SVG/ICO, no stray
  build artefacts resolving to an obsolete path.

### A. Current Admin Web logo asset (before this fix)
No image asset — a CSS-styled Unicode "₦" text glyph, on both the login screen
and the post-auth sidebar.

### B. Approved logo asset
`docs/V1/V1-BRAND-01-assets/MonieNaija-Fintech-Logo-Identity-original.png`
(canonical, 1536×1024, sha256 `752818d9…`, full wordmark + tagline). Its
already-wired derivative inside admin-web is
`apps/admin-web/public/favicon.png` (512×512, RGBA/transparent, sha256
`bba80ea8…`, visually confirmed to be the correct green/gold "M" mark).

### C. Did they match?
**No**, for the in-app logo (login screen + sidebar). **Yes**, for the browser
favicon (already correct before this task).

### F. Were changes necessary?
**Yes.** Fixed by replacing both "₦" text-glyph `<span>` elements with
`<img src="/favicon.png" alt="MonieNaija" ... />`, reusing the exact,
already-approved, already-reviewed asset bytes (`apps/admin-web/public/favicon.png`,
sha256 unchanged, confirmed with `sha256sum` before/after). **No new asset was
generated. No redesign was performed.** Only `width`/`height`/`objectFit` layout
styling was kept; the obsolete `fontSize`/`color`/`backgroundColor`/`borderRadius`
circle styling (which only made sense for a text glyph) was removed.

### G. Commit hash
`8c6d862` — `fix(admin-web): wire the approved MonieNaija logo into LoginScreen and Layout`
(pushed to `origin/arena/01a10374-monienaija`).

### Verification performed on the fix
- **React component testing (automated, Jest + Testing Library):** full
  admin-web suite re-run after the change — **6/6 suites, 27/27 tests pass**
  (no change from the pre-fix baseline; no test asserted on the "₦" glyph).
- **Type checking:** `tsc --noEmit` clean.
- **Build:** `vite build` succeeds; `favicon.png` is correctly copied into
  `dist/`.
- **Automated HTTP validation (dev server, not a browser):**
  - `GET /favicon.png` on the running Vite dev server returns HTTP 200, 72,416
    bytes, sha256 **identical** to the source file on disk.
  - `GET /` returns the correct `<link rel="icon">` and `<title>MonieNaija -
    Admin Operations Desk</title>`.
  - `GET /src/screens/unauthenticated/LoginScreen.tsx` (Vite's dev-transformed
    JS) was inspected directly and confirmed to contain
    `jsxDEV("img", { src: "/favicon.png", alt: "MonieNaija", ... })` — i.e. the
    exact code a real browser would execute now serves the image tag, not the
    glyph.
- **What was NOT done:** an actual browser/visual screenshot of the rendered
  page. This sandbox has no Chromium/Playwright/Puppeteer available (confirmed
  in the prior V1-ADMIN-LOCAL-LOGIN-01 task); that limitation stands unchanged.
  The verification above (byte-identical served asset + confirmed presence in
  the exact JS a browser would run + passing component tests) is the strongest
  non-browser confirmation available, but it is **not** a substitute for a
  human or headless-browser visual check before sign-off.

---

## Question 2 — Default admin role/capabilities

Full 8-step sequence executed against a freshly rebuilt stack (embedded
Postgres → migrations → seed → backend → live HTTP calls), all against the
actual current `HEAD`.

| Step | Action | Result |
|---|---|---|
| 1 | Seed default admin | `{"created": true, "email": "admin@monienaija.local"}` |
| 2 | Seed again | `{"created": false, "note": "...already exists — no change made (idempotent)."}` |
| 3 | Confirm exactly one row | `SELECT * FROM local_admin_credentials` → **exactly 1 row** (`admin@monienaija.local`, `hash_algorithm: PBKDF2`) |
| 4 | Login with documented password | `POST /api/v1/internal/a2/workforce/local-admin-sessions` with `MonieNaijaAdmin123!` → HTTP 200, session issued |
| 5 | Confirm authenticated session | Used the issued bearer token against a real privileged endpoint (`GET /api/v1/internal/capabilities`) → **HTTP 200**; same call with no token → **HTTP 401** (fail-closed confirmed) |
| 6 | Confirm persisted authorization identity | Queried `a2_workforce_sessions` directly by session ID — see exact row below |
| 7 | Confirm logout/revocation | `DELETE /api/v1/internal/a2/workforce/sessions/:id` → HTTP 200; re-using the same token afterwards → **HTTP 401**; DB row confirmed `status: REVOKED` with reason recorded |
| 8 | Confirm re-login | Second login succeeded, new session issued with the same roles/scopes; wrong password rejected with HTTP 401 |

### Exact persisted `a2_workforce_sessions` row (step 6, verbatim from the database)

```json
{
  "principal_id": "https://local-dev-identity.monienaija.invalid:mock-sandbox-subject",
  "issuer": "https://local-dev-identity.monienaija.invalid",
  "subject": "mock-sandbox-subject",
  "audience": "workforce-admin",
  "status": "ACTIVE",
  "assurance_level": "MFA",
  "roles": ["FINANCE_ADMIN", "FINANCE_AUDITOR", "FINANCE_CONTROLLER", "FINANCE_PREPARER"],
  "scopes": ["finance:audit", "finance:prepare", "privileged:approve", "privileged:execute"]
}
```

### Important structural finding (not a defect, but must be stated plainly)

`local_admin_credentials` stores **only** the login credential (email +
password hash) — it has **no role column**. The actual role grant happens at
**login time**, in `A2WorkforceSessionService.resolve()`:

- The local-admin login path always produces the same fixed
  `principalId` (`…:mock-sandbox-subject`) regardless of which credential row
  authenticated.
- For that specific `mock-sandbox-subject` principal, `resolve()` takes a
  **different code path** than real workforce users: it returns **every
  `enabled: true` role defined in `A2_FINANCE_ROLES_JSON`** — it is **not**
  looked up from the `a2_finance_role_assignments` table at all. I confirmed
  this directly: `SELECT * FROM a2_finance_role_assignments WHERE
  principal_id LIKE '%mock-sandbox%'` returns **zero rows**.
- In other words: the admin's role set is a blanket, config-driven dev-mode
  grant tied to the shared sandbox-bypass identity, not a row-level
  authorization assignment tied individually to the `admin@monienaija.local`
  credential. This is consistent with the documented, deliberate design of the
  local-admin login feature (a `NODE_ENV=development|test`-gated convenience
  reusing the pre-existing, already-reviewed sandbox bypass — see
  `workforce-oidc.service.ts` and `local-admin-authentication.service.ts`), but
  it is worth your awareness: with the current `.env`, this account receives
  **all four** configured finance roles, which is the maximal available
  authorization set — not a scoped-down "administrator" role in the usual
  sense.

### D. Exact role assigned to `admin@monienaija.local`
`FINANCE_ADMIN`, `FINANCE_AUDITOR`, `FINANCE_CONTROLLER`, `FINANCE_PREPARER`
(every role currently `enabled: true` in `A2_FINANCE_ROLES_JSON`), granted via
the config-driven sandbox-bypass path described above — **not** via a
persisted per-principal row in `a2_finance_role_assignments`.

### E. Exact capabilities/authorization available
- Scopes: `finance:audit`, `finance:prepare`, `privileged:approve`,
  `privileged:execute` (the union of all four roles' scopes).
- `assuranceLevel: MFA`, `type: PRIVILEGED` (the authorization principal type
  is elevated to `PRIVILEGED` specifically because `FINANCE_ADMIN` is present).
- Practically: this account can reach every `internal/a2/workforce`-gated
  administrative action currently implemented, since it holds both
  `privileged:execute` and `privileged:approve` plus every finance scope. This
  **is** the intended V1 administrator account and it **can** access the
  Admin Web functions intended for the administrator — confirmed by directly
  exercising a live privileged endpoint (`GET /api/v1/internal/capabilities`)
  with its token and getting HTTP 200.

### Validation-type discipline (as required)
- **Automated HTTP validation:** steps 1–8 above, all executed as literal
  `curl` calls against the live NestJS backend (port 3000) plus direct SQL
  queries against the live embedded Postgres instance. This is real,
  end-to-end backend verification — not a mock.
- **React component testing:** the admin-web Jest/Testing-Library suite
  (6/6 suites, 27/27 tests) — verifies component rendering/behaviour in
  jsdom, not an actual browser.
- **Actual browser/manual validation:** **not performed.** This sandbox has no
  Chromium/Playwright/Puppeteer, as already established and documented in the
  prior V1-ADMIN-LOCAL-LOGIN-01 report. No attempt was made to reinstall it
  this turn, per your standing instruction. **Do not treat anything in this
  report as browser-based UAT — it is UAT-readiness verification only.**

---

## Summary

| Item | Answer |
|---|---|
| A. Current Admin Web logo asset (before fix) | Plain "₦" text glyph — no image asset |
| B. Approved logo asset | `docs/V1/V1-BRAND-01-assets/MonieNaija-Fintech-Logo-Identity-original.png` (canonical); `apps/admin-web/public/favicon.png` (already-wired derivative) |
| C. Did they match? | No (login + sidebar); Yes (favicon only) |
| D. Exact role assigned to `admin@monienaija.local` | `FINANCE_ADMIN`, `FINANCE_AUDITOR`, `FINANCE_CONTROLLER`, `FINANCE_PREPARER` (config-driven, all enabled roles) |
| E. Exact capabilities available | Scopes `finance:audit`, `finance:prepare`, `privileged:approve`, `privileged:execute`; `assuranceLevel: MFA`; `type: PRIVILEGED`; confirmed working against a live privileged endpoint |
| F. Were changes necessary? | Yes — branding fix only; role/authorization behaviour required no change, only verification |
| G. Commit hash | `8c6d862` |

**This is UAT-readiness verification, not full Admin Web UAT.** A real
browser/manual pass is still required before sign-off, since no headless or
interactive browser is available in this sandbox.
