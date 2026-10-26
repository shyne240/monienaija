# V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01 — First Workforce/Admin Access on a Fresh Deployment

**Audience:** V1 platform operator performing the one-time establishment of the first
`FINANCE_ADMIN` workforce principal.
**Status:** Authoritative operator procedure for V1-BOOTSTRAP-IMPLEMENTATION-01.
**Companion files:**
- `docs/deployment/config/v1-workforce-bootstrap.env.template` — configuration template (validated by the real config parser)
- `scripts/generate-bootstrap-statement.ts` — offline statement generator (`npm run bootstrap:statement`)
- `docs/V1/V1-BOOTSTRAP-AUDIT-01.md` — audit background
- `docs/archive/phases-a2-a7/A2-FINANCE-ROLE-ENTITLEMENT-AND-BOOTSTRAP-CONTRACT.md` — statement/entitlement contract

> Security note: this runbook references secrets by location only. It never contains
> secret values, and neither should any artifact you produce from it.

---

## 1. Prerequisites

| Prerequisite | Detail |
|---|---|
| Fresh deployment reachable | Database migrated (`npm run migration:run` — migrations are NOT auto-applied), application built (`npm run build`) and started. |
| OIDC provider onboarded | An enterprise OIDC IdP (Entra ID / Keycloak / Okta / any conforming provider) with: a **real operator account** for the first administrator, **MFA enrolled and enforced** for that account, and a registered client for the workforce console. You need its **issuer URL**, **JWKS URI**, the **audience** the API should accept, and the **client id**. |
| Basic operator host | A controlled machine with this repository and `npm ci` (dev dependencies included — the statement generator runs under `ts-node`, which ships with the repo's dev toolchain). The ceremony can and should be done fully offline after checkout; the generator never calls the network. |
| Access-change reference | A change-ticket/approval reference for this access-granting action (recorded in the platform audit trail). |
| A fresh nonce per attempt | Generated at ceremony time, e.g. `openssl rand -hex 16`. Never reused. |

## 2. Required OIDC configuration

Set from `docs/deployment/config/v1-workforce-bootstrap.env.template` (PRODUCTION-REQUIRED section):

```
NODE_ENV=production
A2_WORKFORCE_ENABLED=true
A2_WORKFORCE_OIDC_ISSUER=<your IdP issuer URL — HTTPS>
A2_WORKFORCE_OIDC_JWKS_URI=<your IdP JWKS URL — HTTPS>
A2_WORKFORCE_OIDC_AUDIENCE=<audience your IdP puts in workforce idTokens>
A2_WORKFORCE_OIDC_CLIENT_ID=<IdP client id of the workforce console>
A2_WORKFORCE_INTERNAL_AUDIENCE=workforce-admin
```

The validator enforces HTTPS for issuer/JWKS when `NODE_ENV=production` and refuses
startup otherwise. Also copy the policy JSON blocks (`A2_FINANCE_ROLES_JSON`,
`A2_MAKER_CHECKER_RULES_JSON`, `A2_WORKFORCE_RATE_LIMITS_JSON`) from the template —
they are a validated starting set; adjust scopes/actions only with access-review approval
while preserving the structural invariants documented inline in the template.

Apply (restart) and confirm the app boots — an invalid block fails closed at startup.

## 3. Bootstrap key setup (offline key ceremony)

On the operator host:

1. Change into the repository checkout (offline is fine from here).
2. Decide the key id, e.g. `bootstrap-2026-09-30-prod` (pattern `[A-Za-z0-9][A-Za-z0-9_.:-]*`).
3. Choose ONE key source:
   - **Ephemeral (recommended for the one-time ceremony):** pass `--generate-ephemeral`.
     The keypair exists only in the generator's memory for the signing operation; only
     the PUBLIC key is ever printed, as the `A2_BOOTSTRAP_JWKS_JSON` snippet.
   - **Existing operator-controlled private key:** create/locate an RSA keypair offline
     (e.g. `openssl genrsa -out bootstrap-key.pem 2048`), keep the file on the ceremony
     host only, and pass `--private-key-pem bootstrap-key.pem`. The generator derives
     the public JWK from it. Shred the PEM after the ceremony window closes
     (`shred -u bootstrap-key.pem`).

The private key is never put into env files, the database, the repository, tickets,
or chat. Nothing in the platform ever needs it after the single consumption.

## 4. Generate the signed one-time bootstrap statement (offline)

```
npm run bootstrap:statement -- \
  --generate-ephemeral \
  --kid bootstrap-2026-09-30-prod \
  --environment production \
  --issuer 'https://idp.example.com' \
  --subject '<OIDC sub of the first admin — run the §7 pre-login to discover it if needed>' \
  --audience 'monienaija-v1-bootstrap' \
  --scopes '["privileged:execute"]' \
  --effective-from 2026-09-30T00:00:00.000Z \
  --effective-to   2026-10-01T00:00:00.000Z \
  --nonce "$(openssl rand -hex 16)" \
  --approval-change-reference 'CHG-000123'
```

Binding rules (the server enforces every one of these — see `consumeBootstrap`):
- `--issuer` + `--subject` must be the OIDC identity (iss, sub) of the administrator
  who will call the bootstrap endpoint. The platform derives
  `principalId = <issuer>:<subject>` and requires it to equal the calling session's principal.
- `--audience` must equal `A2_BOOTSTRAP_AUDIENCE` (see §5).
- `--scopes` must **exactly equal** both the `FINANCE_ADMIN` scopes in
  `A2_FINANCE_ROLES_JSON` and `A2_BOOTSTRAP_ADMIN_SCOPES_JSON` (order-insensitive set equality).
- `--environment` must equal the server's `NODE_ENV`.
- Window: `effective-from` in the past, `effective-to` in the future at consumption;
  `expires-at` defaults to issued-at + 15 minutes — **consume promptly**.

Output is JSON with `statement` (the compact JWS), `publicJwk`, `envSnippet`, and
`selfCheck: 'OK'` (the tool ran the production verifier over its own output before printing).

## 5. Open the bootstrap window (server side)

On the deployment, add to the environment (still using the template values):

```
A2_BOOTSTRAP_ENABLED=true
A2_BOOTSTRAP_ISSUER=monienaija-v1-bootstrap-operator
A2_BOOTSTRAP_AUDIENCE=monienaija-v1-bootstrap
A2_BOOTSTRAP_JWKS_JSON=<paste envSnippet.A2_BOOTSTRAP_JWKS_JSON from §4 — PUBLIC key only>
A2_BOOTSTRAP_ADMIN_SCOPES_JSON=["privileged:execute"]
```

Restart the application. Keep this window as short as possible (minutes, not days).

## 6. Invoke the bootstrap endpoint

The consumer must be the administrator's **own MFA-assured workforce session**:

1. Obtain the admin's OIDC idToken from the IdP (normal interactive login WITH MFA).
2. Exchange it for a workforce session (public exchange surface):
   `POST /api/v1/internal/a2/workforce/sessions` with body `{"idToken": "<idToken>"}`.
   Response contains `accessToken` (Bearer).
3. Submit the statement:
   `POST /api/v1/internal/a2/workforce/bootstrap`
   `Authorization: Bearer <accessToken>` , body `{"statement": "<compact JWS from §4>"}`.

## 7. Expected response/result

HTTP 200 with the assignment view, e.g.:

```json
{
  "assignmentReference": "a2-fin-role-…",
  "assignmentVersion": 1,
  "principalId": "https://idp.example.com:<sub>",
  "roleKey": "FINANCE_ADMIN",
  "scopes": ["privileged:execute"],
  "status": "ACTIVE",
  "interim": true,
  "effectiveFrom": "…", "effectiveTo": "…",
  "assignedBy": "bootstrap:CHG-000123",
  "bootstrapReference": "a2-bootstrap-…",
  "approvalIds": [],
  "auditReferences": ["…"]
}
```

Database effects (all inside one SERIALIZABLE transaction): one ACTIVE
`a2_finance_role_assignments` row (`FINANCE_ADMIN`, `interim=true`), one
`a2_workforce_bootstrap_consumptions` row (nonce consumed), and a
`WORKFORCE_BOOTSTRAP_CONSUMED` audit event. **No manual SQL is ever required.**

## 8. First FINANCE_ADMIN login

Immediately after consumption the SAME workforce session resolves roles dynamically:
the admin's subsequent requests carry `FINANCE_ADMIN` rights (type `PRIVILEGED`).
On later logins, the normal exchange (`POST …/workforce/sessions` with a fresh MFA
idToken) resolves the role from the assignment's effective window.

## 9. MFA requirements (recap — enforced in code)

- Workforce session establishment requires an MFA-assured assertion (`amr` contains
  `mfa`, `auth_time` within 300 s + 60 s skew); otherwise no session.
- Bootstrap consumption requires an MFA-assured session (explicit re-check).
- All `A2_FINANCE_*` role administration and privileged approvals require MFA assurance
  and the maker/checker rule's `minimumAssurance: 'MFA'`.

## 10. Post-bootstrap role/user provisioning

The bootstrap admin has these constrained powers (else maker/checker applies):
- It may directly create the **FIRST assignment of each configured non-admin role**
  (`FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`) to OTHER authenticated
  workforce principals:
  `POST /api/v1/internal/a2/workforce/roles`
  `{"targetPrincipalId":"<issuer>:<sub>","roleKey":"FINANCE_CONTROLLER","effectiveFrom":"…","effectiveTo":"…"}`.
- It **cannot**: self-assign, change its own scopes, create another `FINANCE_ADMIN`
  (API-prohibited), or create new roles/scopes (they are deployment configuration).
- Provision additional admins? By design FINANCE_ADMIN singleton is honored:
  extend operational privileges by assigning the non-admin roles; do not attempt
  DB edits (they are audited and unnecessary).

Practical minimum for operability: assign at least one `FINANCE_CONTROLLER`
(approver) — otherwise maker/checker actions that require approvals cannot complete.

## 11. Maker/checker expectations

Subsequent (non-first) `FINANCE_ROLE_ASSIGN` / `FINANCE_ROLE_REVOKE` operations obey
`A2_MAKER_CHECKER_RULES_JSON`: initiating roles, ≥ minimumApprovals distinct approvals
from approving roles, self-approval prohibition, MFA, and semantic fingerprints via
`POST /internal/a2/workforce/approvals/request` + `POST …/approvals/:id/approve`,
then execute with `approvalIds`. The consumed nonce semantics above do NOT apply —
approvals are the ongoing control; bootstrap is one-time.

## 12. One-time bootstrap protection

Four independent guards (all fail-closed, all verified in
`test/v1-workforce-bootstrap-01.integration.spec.ts`):
1. **Completion guard:** any existing ACTIVE `FINANCE_ADMIN` assignment →
   `Finance bootstrap already completed` (409).
2. **Nonce consumption:** each nonce is stored at consumption; an identical replay →
   `Bootstrap replayed`; a DIFFERENT statement reusing a consumed nonce →
   `Bootstrap nonce conflict`.
3. **Configuration gate:** `A2_BOOTSTRAP_ENABLED=false` → `Bootstrap disabled` (403).
4. **Window gate:** bootstrap only possible during the operator-opened env window.

## 13. Failure / expiry behavior

| Condition | Server outcome |
|---|---|
| `A2_BOOTSTRAP_ENABLED` not true | 403 "Bootstrap disabled" |
| Calling session lacks MFA assurance | 403 "Bootstrap requires MFA" |
| Unknown `kid`, mismatched key environment, revoked/out-of-window key | 401 "Unknown bootstrap signing key" / "not trusted" |
| Bad/tampered signature | 401 "Invalid RS256 signature" |
| Non-canonical payload | 401 "Bootstrap payload is not canonical" |
| Principal/issuer/environment/audience mismatch | 401 "Bootstrap identity or environment mismatch" |
| Scopes ≠ configured FINANCE_ADMIN scopes, or role ≠ FINANCE_ADMIN | 403 "Bootstrap role or scopes not allowed" |
| Statement/window not yet valid or expired (`issuedAt > now`, `expiresAt ≤ now`, `effectiveFrom > now`, `effectiveTo ≤ now`) | 401 "Bootstrap outside validity" |
| Nonce replay / nonce conflict | 409 "Bootstrap replayed" / "Bootstrap nonce conflict" |
| FINANCE_ADMIN already exists | 409 "Finance bootstrap already completed" |
| Malformed compact JWS (shape/JSON/duplicate keys) | 401 malformed-parse error |

The statement itself expires quickly (`expires-at`); an expired statement is simply
rejected — regenerate with a fresh nonce; the FINANCE_ADMIN grant, once consumed,
persists for its **assignment window** (`effective-from/to`) and is renewable only
through normal role administration afterwards, not via new bootstrap statements.

## 14. Rotate / recover operational access (without bypassing controls)

**Planned rotation of the admin's access:** the assignment has a finite window. Before
expiry, have the current FINANCE_ADMIN initiate a normal `FINANCE_ROLE_ASSIGN`
(chicken-and-egg is avoided because the window overlaps) — no, FINANCE_ADMIN
assignments are bootstrap-only: instead, RELY on OIDC identity continuity (the same
principal keeps its assignment until `effective-to`) and ensure the assignment window
covers your operational horizon. If the window lapses without a successor structure,
perform a *new controlled* bootstrap ceremony after revoking the old assignment:
FINANCE_ADMIN self-revocation is prohibited; a revocation must be executed through the
privileged approval path — if that is impossible, the recovery path is the operating
procedure below.

**Lost admin identity (person leaves / IdP account lost):** the IdP is the identity
authority — re-provision the SAME `sub` for a successor in the IdP (identity recovery
happens in the IdP, never in this platform). If the exact `sub` cannot be recovered,
the existing `FINANCE_ADMIN` assignment is dead weight: it expires at `effective-to`.
After expiry the completion guard still blocks a new bootstrap while the old assignment
is ACTIVE. Standard recovery: run a controlled incident change to revoke the expired
assignment (privileged approval path; DB status change is NOT sanctioned), then repeat
this runbook for the successor identity.

**Compromised statement (before consumption):** it is useless without (a) the matching
MFA session of the named principal, (b) an open bootstrap window, and (c) no consumed
nonce — but still rotate: close the window (`A2_BOOTSTRAP_ENABLED=false`), discard the
key, and redo the ceremony with a new nonce/kid.

**Compromised private key:** identical recovery — the key only matters during the open
window; rotate env `A2_BOOTSTRAP_JWKS_JSON` (remove the compromised public key) and
redo §3–§6.

**Never do:** manual `INSERT/UPDATE` into A2 tables; enable the mock-sandbox bypass in
production (there is no env for it; do not alter `NODE_ENV`); create FINANCE_ADMIN via
SQL; disable MFA at the IdP for workforce accounts.

---

## Appendix A — What the statement contains (schema of `A2BootstrapStatementV1`)

`schemaVersion=1, environment, issuer, workforceSubject, principalId (<issuer>:<subject>),
initialRoleKey=FINANCE_ADMIN, scopes[], effectiveFrom, effectiveTo, audience,
approvalChangeReference, nonce, issuedAt, expiresAt, signingKeyReference (= JWS kid)` —
canonical (recursively key-sorted, whitespace-free) JSON, RS256-signed compact JWS with
header `{alg:"RS256", typ:"JWT", kid}`. Timestamps are millisecond UTC ISO-8601.

## Appendix B — Traceability

- Endpoint & principal requirements: `src/authorization/workforce-administration.controller.ts` (`POST /internal/a2/workforce/bootstrap`, rate-limited, session-bound).
- Verification logic: `src/authorization/finance-role-administration.service.ts` → `consumeBootstrap`.
- Crypto/canonicalization: `src/authorization/workforce-crypto.ts` (reused by the generator).
- Configuration validation: `src/authorization/workforce-configuration.ts`.
- End-to-end proof: `test/v1-workforce-bootstrap-01.integration.spec.ts` (11 cases, real PostgreSQL).
