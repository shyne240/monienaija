# V1-BOOTSTRAP-AUDIT-01 — Production Bootstrap & Initial-Login Audit

**Baseline audited:** `0e1d2bb2665ebe280cc03315594ad577588c412a` (branch `arena/01a0d883-monienaija`, remote-verified)
**Classification:** AUDIT ONLY — no source, migration, API, test, or configuration changes were made. No users or credentials were created. No secret values are reproduced in this document.

---

## 1. Current authentication architecture

V1 has **four distinct principal planes**, each with its own authentication mechanism and session store. Identity is never shared across planes; a bearer token validates in exactly one store (`src/authorization/runtime-access.guard.ts`).

### 1.1 Workforce / Admin (internal control plane)
- **Mechanism:** External OIDC identity, no passwords in-platform. `POST /api/v1/internal/a2/workforce/sessions {idToken}` exchanges a provider-issued RS256 idToken (JWKS from `A2_WORKFORCE_OIDC_JWKS_URI`, issuer/audience/azp pinned by config) for an internal session — a 32-byte random bearer stored only as SHA-256 hash (`A2WorkforceSessionService.establish`, `src/authorization/workforce-session.service.ts`).
- **MFA:** Session establishment *requires* `assuranceLevel === 'MFA'` (OIDC `amr` includes `mfa` and `auth_time` ≤ 300 s, skew 60 s — `src/authorization/workforce-oidc.service.ts`). Session TTL 60–3600 s (default 900 s).
- **Roles/entitlements:** Exactly four roles (`FINANCE_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`), defined as *deployment configuration* (`A2_FINANCE_ROLES_JSON`), validated at startup by `src/authorization/workforce-configuration.ts` (schema, maker/checker eligibility, MFA constraints fail-closed). **No assignment is seeded.** OIDC claims are ignored for roles; effective rights come only from `A2FinanceRoleAssignment` rows (explicit effective windows, revocable, audited, `interim=true` for bootstrap lineage).
- **Type mapping:** `FINANCE_ADMIN` → principal type `PRIVILEGED`; any other assignment → `OPERATOR` (`workforce-session.service.ts:145`). `SUPPORT`/`SERVICE` principal types exist in route policies but are not produced by any current role mapping; `SERVICE` is reserved for the partner-callback boundary (A6, disabled by default).
- **Maker/checker:** `A2_MAKER_CHECKER_RULES_JSON` binds actions (incl. `FINANCE_ROLE_ASSIGN`, `FINANCE_ROLE_REVOKE`, `FINANCE_CONTROL_POLICY_ACTIVATE`) to initiating/approving roles with minimum approvals, self-approval prohibition, and MFA; decisions executed through `PrivilegedActionApprovalService`.
- **Route enforcement:** every `/api/v1/internal/**` route (except the session exchange and partner callback) resolves to `WORKFORCE_SESSION` in `src/authorization/route-policy-registry.ts`; the global `RuntimeAccessGuard` (APP_GUARD, `src/app.module.ts:213`) fails closed. Each request also emits an `AUTHORIZATION_DECISION` audit event.
- **Rate limiting:** token-bucket categories incl. `workforce-authentication` and `workforce-bootstrap` (`A2SecurityRateLimitService`).
- **Lifecycle surfaces:** session revoke (`DELETE /internal/a2/workforce/sessions/:id`), role assign/revoke with maker/checker, approval engine. Workforce *password* management, *password reset*, and *platform-issued OTP* do not exist by design — identity and MFA are delegated to the OIDC provider.

### 1.2 Customer
- **Credential:** `customer_authentication_credentials` — one active PASSWORD credential per customer; hash algorithms allowed `PBKDF2/SCRYPT/ARGON2ID/BCRYPT`; lockout after 5 failures; password history, expiry, status (`PENDING/ACTIVE/SUSPENDED/REVOKED`).
- **Login:** `POST /api/v1/customers/sessions` (alias `/login`) with `customerId + password` (unauthenticated `CUSTOMER_LOGIN` mode). Password verified via `timingSafeEqual`; **account must be `CustomerStatus.ACTIVE`** or authentication is denied *after* verification without revealing existence (`authentication-execution.service.ts`, S-FIX-01 binding).
- **Session:** random 32-byte bearer, SHA-256 hash at rest, audience/expiry/revocation (`authentication-session.service.ts`; `customers/me/sessions` safe view exists).
- **Self-service:** profile read/update, password change (`POST /customers/me/password` — verifies current password, server-side PBKDF2 hashing, rotations version), transaction-PIN set/verify, MFA enrollment/method/recovery-code/trusted-device table machinery, password-reset request/token machinery.
- **No public registration endpoint exists** (see §6).

### 1.3 Agent
- **Lifecycle:** public application (`POST /api/v1/agents/applications`, unauthenticated `AGENT_LOGIN` mode) → workforce review/approval (`/internal/agents/applications/**`) → workforce activation (`POST /internal/agents/applications/:applicationId/activate` / `/internal/admin/agents/**`; OPERATOR+). Suspension/termination/reactivation are workforce-only.
- **Credential:** `agent_authentication_credentials` (same hash-algorithm family; one active row per agent). **Nothing in `src/` ever inserts into this table** — only the migration creates it and the execution service reads it (verified by repository-wide search).
- **Login:** `POST /api/v1/agents/sessions` (alias `/login`) with `agentId + password`; agent must be `ACTIVE`; credential ACTIVE/unlocked/unexpired. Session bearer hash at rest.
- **Agent capability:** class-based services (`agent_classes`), service-capability gate, transaction authorization separate (see §7).

### 1.4 Aggregator
- Identity, lifecycle (DRAFT→ACTIVE→SUSPENDED→TERMINATED), agent relationships, and admin (list/read) surfaces exist (`src/aggregator/`, A18 foundation). **No login, credential, or session issuance of any kind** exists; `route-policy-registry.ts` documents this explicitly ("A18 does not expose aggregator login; foundation only"). Identity/lifecycle is complete; usable login is intentionally absent (see §6.4, standing scope decision preserved).

---

## 2. Current bootstrap mechanisms

### 2.1 Workforce first-admin bootstrap (the designed path)
`POST /api/v1/internal/a2/workforce/bootstrap` → `A2FinanceRoleAdministrationService.consumeBootstrap`:
1. Gate: `A2_BOOTSTRAP_ENABLED=true` config; caller must hold an MFA-assured workforce session (thus an OIDC-authenticated identity).
2. Input: compact RS256 **bootstrap statement** signed by an *external* RSA key. Trusted public parts are provisioned via `A2_BOOTSTRAP_JWKS_JSON` and are **environment-bound** (`environment` must equal `NODE_ENV`), optionally validity-windowed/revocable, and are distinct from OIDC keys.
3. Payload contract (`docs/A2-FINANCE-ROLE-ENTITLEMENT-AND-BOOTSTRAP-CONTRACT.md`): schema version, environment, issuer, subject, `principalId = issuer:subject`, role `FINANCE_ADMIN`, exact allowlisted scopes (must equal configured FINANCE_ADMIN scopes and `A2_BOOTSTRAP_ADMIN_SCOPES_JSON`), effective window, audience, change reference, nonce, issued-at/expiry, key reference. Canonical (key-sorted, whitespace-free) payload enforced.
4. Fail-closed: unknown `kid`, environment/audience/identity/window mismatch, non-canonical payload, nonce reuse, or an existing ACTIVE `FINANCE_ADMIN` assignment → rejected. Hard one-time guard: "Finance bootstrap already completed".
5. Effects: creates the single initial `FINANCE_ADMIN` assignment (`assignedBy = bootstrap:<change-reference>`, unique bootstrap reference), records `WORKFORCE_BOOTSTRAP_CONSUMED` audit, consumes the nonce in `A2WorkforceBootstrapConsumption`.
6. Posture thereafter: the bootstrap admin **cannot** self-assign, change own scopes, assign another `FINANCE_ADMIN`, or create roles/scopes; it may directly create only the *first* assignment of each configured non-admin role to another authenticated principal; all subsequent assigns/revokes use maker/checker approvals.

**Tooling status:** the repository contains **no signing utility, no runbook, no env template** for producing a statement or keypair beyond that contract document; tests generate ephemeral RSA keypairs at runtime.

### 2.2 Application-startup seeding
Only the **capability registry** seeds at startup (`CapabilitySeedService implements OnApplicationBootstrap`, idempotent) — capability *definitions*, not users. Migrations seed only system ledger accounts (payment capabilities, C2C unclaimed-liability, agent funding pool, V1 commercial accounting families, pilot controls) and **zero** fee/commission/reward rules and **zero** user, credential, role-assignment, or session rows (verified across `src/migrations/`).

### 2.3 Environment-controlled accounts
`A2_*` variables control enablement, keys, role/rate-limit JSON — all references/public material only. `.env.example` ships workforce **disabled** (`A2_WORKFORCE_ENABLED=false`, fail-closed) and a local-only placeholder DB password. There is **no** environment-controlled initial username/password anywhere.

---

## 3. Fresh-deployment walkthrough

Fresh PostgreSQL → migrations → application startup → first login attempt:

1. **Schema:** `npm run migration:run` (TypeORM CLI) is the only runner — `migrationsRun: false`, `synchronize: false` (`src/config/database.config.ts`); neither `Dockerfile` (`CMD ["node","dist/main.js"]`, `NODE_ENV=production`) nor `docker-compose.yml` applies migrations. Migration run is a deliberate out-of-band deploy step.
2. **Startup:** app validates env (fail-closed on malformed A2 config); seeds capability registry if empty; emits no accounts.
3. **First login attempts, fresh DB:**
   - Customer login: impossible — no customer rows exist and no HTTP path creates one (§4.2). → 401 (generic).
   - Agent login: impossible — agent records could be created through applications/activation, but **no credential rows exist and no path creates them** (§4.3). → 401.
   - Workforce session exchange: requires a valid OIDC idToken from the configured external provider. Without `A2_WORKFORCE_ENABLED=true` + OIDC config, the endpoint is disabled (401). With config: session establishes, roles = **empty** (no assignments) — authenticated but authorized for nothing until bootstrap consumed.
   - Bootstrap: with MFA-assured session + valid signed statement → first `FINANCE_ADMIN` created (one-time).
4. **After bootstrap:** FINANCE_ADMIN can create the first assignments of the three non-admin roles, run maker/checker approvals, and operate every `/internal/**` surface within its scopes.

### A–J determination
- **A. First legitimate administrator:** an identity created in the external OIDC provider (outside this repo, by design), then granted `FINANCE_ADMIN` via the signed bootstrap statement.
- **B. Initial credential:** the OIDC idToken issued by the provider after its own identity proofing + MFA; the platform issues no password.
- **C. Secure establishment:** provider-managed identity verification and MFA (`amr`/`auth_time` enforced, freshness ≤ 300 s); internal session is a hashed random token with short TTL; bootstrap statement RS256-signed by an environment-bound key provisioned through deployment config.
- **D. Roles/capabilities:** one-time signed bootstrap for FINANCE_ADMIN; first-of-each-role direct assignments by that admin; everything else via maker/checker approvals with MFA and self-approval prohibition. All audited, windowed, revocable.
- **E. Account active:** session ACTIVE on issuance; assignment ACTIVE within its configured effective window.
- **F. Authenticates through the real production API:** YES — `/internal/a2/workforce/*` and all `/internal/**` routes consume the workforce session through the global guard.
- **G. MFA/OTP required:** YES for workforce session establishment, bootstrap, role administration, and approvals (code-enforced).
- **H. Can the admin then operate V1:** MOSTLY — limit catalogue/profiles/rules/assignments, product catalogue, fee/commission/reward rule registries, agent classes, aggregators, agent application approval + lifecycle, agent fund/defund, customer lifecycle transitions (`PATCH /customers/:id`), admin investigation surfaces (customers, agents, notifications, tickets, commercial evidence) are all reachable workforce endpoints. **Exceptions (V1 gaps):** cannot create a customer record, cannot issue/reset a *first* customer or agent login password, cannot reach back-office customer sub-resources (`/customers/:id/onboarding|agreements|approval|authentication-credentials`) because those routes resolve to the non-internal policy where workforce principals are never authenticated (§4.2), and cannot create an `OPERATOR`-typed ↔ `SUPPORT`-typed mapping (type vocabulary partially unwired — previously recorded as SECURITY DECISION in `V1-END-TO-END-PROCESS-AUDIT` §12).
- **I. Manual SQL remains necessary:** YES, for (i) customer record creation, (ii) customer first credential, (iii) agent first credential. These are the only V1 account-provisioning actions with no reachable HTTP path.
- **J. Sandbox credential remains necessary:** NO — no sandbox mechanism is needed by the design, but two dev-gated bypasses remain in code (§4.5) and would need NODE_ENV discipline in operations.

---

## 4. Test/sandbox credentials and access paths discovered

No production-usable credential exists in the repository. No `admin/admin`, `password/password`, e-mail-pattern fixture accounts, seeded users, or migration-created accounts were found (repository-wide scan of `src/`, `apps/`, `scripts/`, migrations, README).

| # | Location | Account/type | Scope | Can become V1 access? |
|---|---|---|---|---|
| 1 | `src/authorization/workforce-oidc.service.ts:20` — accepts any token beginning `mock-sandbox-token-*`, fabricating an MFA-assured workforce identity | synthetic workforce identity ("sandbox") | **Development/test only** — gated `NODE_ENV !== 'production'` | No, if `NODE_ENV=production` is correct on deploys (fail-closed otherwise by the gate; a mis-set NODE_ENV is the only exposure). Removal before V1 GA is recommended hygiene, not a correctness blocker |
| 2 | `src/authorization/workforce-session.service.ts:119` — grants ALL enabled roles/scopes to the mock-subject principal | synthetic all-roles principal | **Development/test only** — same `NODE_ENV` gate | Same as #1 |
| 3 | `apps/admin-web/src/config/index.ts` — `DEV_AUTH_MOCK = true` hardcoded; `LoginScreen.tsx` quick-fill buttons (`mock-sandbox-token-…`, mock bootstrap statement) | UI convenience for sandbox operators | **Development/test only**; the mock *bootstrap statement* has **no** backend support (bootstrap path stays strictly signed) | No — depends on #1 server-side gate |
| 4 | `test/*.spec.ts` (A21/A23/A24/A25, hardening, v1-* suites) — fixture plaintext passwords (pattern `correct-password-*`, `agent-pass-*`, PINs like `1234`) inserted via **direct SQL** into per-suite ephemeral schemas | customer/agent test credentials | **Test only** — never deployed; suites truncate their own schemas | No |
| 5 | `test/a2-workforce-*.spec.ts` — RSA keypairs generated at runtime (`generateKeyPairSync`) for signing test statements | ephemeral signing keys | **Test only** | No |
| 6 | `scripts/embedded-pg.js`, `docker-compose.yml` — local database superuser credential (DB-level, not an application account); `.env.example` placeholder DB password | local infrastructure DB | **Development/test only** | No (DB-layer; must be network-isolated in any real deploy; not an app login) |
| 7 | Test harness login flows use real HTTP (`POST /agents/sessions`, `POST /customers/sessions`) against fixture rows — these exercise the *production* login code path (verification, lockout, status binding) | N/A (fixture data only) | Test only | No |

**Result:** zero hardcoded *application* credentials in production code; the only code-level sandbox surface is the NODE_ENV-gated mock workforce token (#1/#2) and the admin-web quick-fill (#3).

### 4.1 Classification of the mock surface
The mock bypasses are **DEVELOPMENT/TEST ONLY** by gate. Under the task taxonomy they are *not* production-appropriate and **UNSAFE FOR V1** if ever served with `NODE_ENV ≠ production`; the Dockerfile correctly hard-pins `NODE_ENV=production`, and the production config rejects HTTP (non-HTTPS) OIDC URLs. Removing them is a small hygiene task, not required for the bootstrap mechanism to work.

---

## 5. Security classification of every discovered mechanism

| Mechanism | Classification |
|---|---|
| Workforce OIDC session exchange (RS256 JWKS, issuer/audience/azp/bindings, MFA freshness, hashed sessions, rate limits, decision audits) | **PRODUCTION-APPROPRIATE** (requires external IdP provisioning) |
| A2 first-admin bootstrap (external RS256 statement, env-bound keys, exact scope/identity/window match, canonical payload, one-time guard, nonce consumption, SERTx persistence, audit) | **PRODUCTION-APPROPRIATE** (mechanism complete; *tooling & runbook* **NOT IMPLEMENTED** — see 2.1) |
| Finance role config as deployment configuration (exact 4-role vocabulary, schema validation, maker/checker rules, approval capability constraints) | **PRODUCTION-APPROPRIATE** |
| Privileged action approval engine (request/approve states, fingerprints, minimum approvals) | **PRODUCTION-APPROPRIATE** |
| Workforce route gating (`/internal/**` → WORKFORCE_SESSION; agent/customer tokens explicitly 403; decision audit per request) | **PRODUCTION-APPROPRIATE** |
| Mock sandbox OIDC token + mock subject role grant | **DEVELOPMENT/TEST ONLY** (would be **UNSAFE FOR V1** under any non-production NODE_ENV exposure; removal recommended) |
| admin-web `DEV_AUTH_MOCK` quick-fill | **DEVELOPMENT/TEST ONLY** (frontend constant; harmless only while #above gate holds; must be env-driven or false for V1 builds) |
| Capability-registry startup seed; migration-seeded system ledger accounts | **PRODUCTION-APPROPRIATE** (no accounts/credentials involved) |
| Customer login/session/credential storage (PBKDF2-class hashes, lockout, status binding, hashed sessions) | **PRODUCTION-APPROPRIATE** |
| Customer **record creation** (public or assisted) | **NOT IMPLEMENTED** — no reachable HTTP path (see 6.1) |
| Customer **first credential issuance** | **INCOMPLETE** — `POST /customers/:id/authentication-credentials` exists but (a) accepts an externally computed `passwordHash` (caller-side hashing contract), (b) resolves to CUSTOMER-SELF/workforce policy while workforce tokens are not authenticated on non-internal routes ⇒ practically unreachable for a first credential; chicken-and-egg for SELF | 
| Customer password-reset machinery (requests/tokens/history/security events) | **INCOMPLETE** — service primitives exist and are well-guarded, but there is no end-to-end delivery+consumption HTTP flow for a platform-driven reset that a workforce operator or brand-new customer can complete |
| Customer phone verification / self-activation | **NOT IMPLEMENTED** (V1 activation is a workforce lifecycle PATCH; no OTP-verified phone onboarding) |
| Agent application/approval/activation via workforce | **PRODUCTION-APPROPRIATE** |
| Agent **password credential issuance** | **NOT IMPLEMENTED** — no service method, controller route, or migration seed writes `agent_authentication_credentials` (verified); activation issues no credentials |
| Agent/customer transaction PIN set+verify (self-service after login, separate table, lockout, OTP-challenge machinery) | **PRODUCTION-APPROPRIATE** |
| Agent financial transaction MFA/OTP (challenge issuance/consumption, a11/a14 hardening) | **PRODUCTION-APPROPRIATE** |
| Aggregator login/credential issuance | **NOT IMPLEMENTED** — deliberate; **DECISION REQUIRED** (scope-challenge item, provisional V2 deferral preserved by this audit) |
| `scripts/embedded-pg.js` / compose DB credentials | **DEVELOPMENT/TEST ONLY** |
| Migrations / seeds for users | *(none exist — clean)* |

---

## 6. V1 gap analysis (per principal plane)

### 6.1 Customer
Legitimate V1 flow *as built*: record exists → KYC/onboarding objects → workforce activates (`PATCH /customers/:id`) → credential exists → login works (password → session; PIN + MFA machinery for transactions). **Cannot start from zero:** record creation (`POST /customers`) falls into the fail-closed default route policy and is reachable by no authenticated principal (workforce tokens are only validated in `WORKFORCE_SESSION` mode, which only `/internal/**` routes use; customer/agent tokens lack the required scopes/types). Admin back-office (`internal/customers`) is read-only. All working test coverage creates customer rows by direct SQL — the same manual-database dependency this task wants eliminated.

### 6.2 Agent
Public application → workforce approval → workforce activation all work over HTTP. **Credential issuance is entirely missing:** after activation the agent is ACTIVE yet can never log in because no code path creates `agent_authentication_credentials`. All test coverage inserts the row directly. PIN self-service is complete but unreachable without the password login that precedes it.

### 6.3 Workforce/Admin
End-to-end path exists in code (OIDC → MFA session → bootstrap → roles → operations), and it is the only principle plane whose bootstrap does **not** depend on database manipulation or sandbox credentials. Missing pieces are purely: (i) statement-signing tooling (an offline key ceremony generator), (ii) env configuration template/walkthrough, (iii) operator runbook; (iv) the partial `SUPPORT` type mapping decision already recorded elsewhere.

### 6.4 Aggregator
Identity/lifecycle/relationship/admin surfaces complete; self-service login deliberately absent. **Preserved conclusion:** aggregator self-service remains **DECISION REQUIRED** (`docs/V1-SCOPE-CHALLENGE-01.md`, item 2, provisional defer to V2). This audit neither implements nor rescopes it.

---

## 7. Authentication vs transaction authentication (verified separation)

These are **independent layers** and must not be combined:

| Layer | Customer | Agent | Workforce |
|---|---|---|---|
| Login credential → session | `customer_authentication_credentials` (password; PBKDF2-class) → `customer sessions` (hashed bearer) | `agent_authentication_credentials` (password) → `agent sessions` (hashed bearer) | OIDC idToken (external pwd+MFA) → workforce session (hashed bearer) |
| Transaction auth | `customer_transaction_pins` — 4–12-digit PIN, separate table/hash/version/lockout; verified inside an *authenticated session* for transfers (`POST /customers/me/transfers` requires PIN after login) | `agent transaction PIN` — same isolation; verified inside the agent session for all financial executions (a11) | N/A (assurance level + maker/checker instead) |
| OTP/MFA | MFA enrollment/method/challenge machinery (`mfa_challenges`, hardened OTP flows — a14) for sensitive operations | OTP challenge consumption wired into financial authorization (a11/a14) | OIDC step-up (`amr`/`auth_time` freshness) at session level |

PINs never appear in requests hashes, journals, audits, responses, or logs (verified code paths redact). Passwords exist only in their credential stores. Sessions are bearer-hash-only. **Recommendation: keep exactly this separation; do not merge PIN with login.**

---

## 8. V1 bootstrap requirement verdict

> **Requirement:** "A fresh MonieNaija V1 deployment can obtain legitimate initial operational access through a secure, documented and repeatable process without relying on sandbox credentials or manual database manipulation."

**Verdict: NO (partially satisfied).**

- **Initial *workforce* operational access:** the secure mechanism exists in code (OIDC + signed one-time bootstrap) and uses no sandbox credentials or SQL. It is **not yet "documented and repeatable"** — no runbook, no env template, no statement-generation tooling exists; repeatability depends on ad-hoc operator knowledge. **Partially satisfied.**
- **Operational access more broadly (what the admin must be able to set up):** manual database manipulation is still necessary to (i) create customer records, (ii) issue customer first credentials, (iii) issue agent credentials. Until at least the agent/customer provisioning gaps are closed or explicitly resourced externally (e.g., a separate supervised provisioning console outside this repo — none exists), the requirement as written is **not satisfied**.

**Exact missing pieces:**
1. Operator runbook + env template for `A2_WORKFORCE_ENABLED=true` deployments (valid roles/rules/rate-limit JSON examples, OIDC bindings, bootstrap key provisioning).
2. A documented (and preferably scripted) **offline** bootstrap-statement key ceremony: generate RSA keypair → install public JWK via `A2_BOOTSTRAP_JWKS_JSON` → sign statement for the designated bootstrap principal → consume once → disable `A2_BOOTSTRAP_ENABLED`.
3. Agent initial-credential issuance path (service + workforce-facing route), with forced-rotation/temporary-credential semantics.
4. Customer creation path (decision needed: self-service registration vs assisted back-office creation) + first-credential issuance path consistent with it.
5. Removal or compile-time caging of the mock-sandbox bypasses and the admin-web `DEV_AUTH_MOCK` constant for V1 builds (hygiene).

---

## 9. Recommended V1 bootstrap mechanism (smallest correct solution)

For the **first operational admin** (the problem this task centers on): **Option D/E — use the existing mechanism; supply only configuration, tooling, and documentation.** No new authentication architecture is needed or recommended:

1. **Docs/config (zero code):** operator runbook `docs/V1-BOOTSTRAP-RUNBOOK.md` (to be authored in a follow-up task) covering: OIDC provider onboarding of the first admin account (with MFA), exact `A2_*` env values/templates, bootstrap key ceremony, consumption, post-bootstrap disablement, first role assignments, verification checklist.
2. **Tooling (minimal, offline):** a repo-provided, dependency-light **statement generator** (e.g. `scripts/generate-bootstrap-statement.*` executed locally by the operator — never a server route) producing: ephemeral RSA keypair, public JWK JSON snippet for `A2_BOOTSTRAP_JWKS_JSON`, and the canonical signed statement for a given issuer/subject/window. This is Option B *in shape* (a CLI helper) but it **generates evidence for the existing signed-statement mechanism** instead of inventing a parallel one-time-password flow. Server consumption logic requires **no change**.
3. **Do not adopt:** any environment-controlled *password* for admins, first-run auto-created users, or seeded role assignments — all would violate the fail-closed design intent already encoded in A2T11.

For the **identified plane gaps** (separate follow-ups, not implemented here):
- **Agent credentials (smallest correct):** extend the existing activation flow — workforce (OPERATOR+) issues a *temporary* initial credential in the same transaction as `activateFromApplication` (or a dedicated authenticated endpoint on the internal agent-lifecycle controller), with `passwordExpiresAt`/forced rotation at first login; reuse the existing credential entity, hash pipeline, lockout, and audit conventions. No new auth model.
- **Customer creation/credentials (decision first):** product decision between (a) assisted back-office creation (internal route mirroring the customer service create + credential issuance, hashed server-side, delivered over a one-time code), and (b) public registration with phone-OTP verification reusing the existing MFA challenge machinery. Either reuses existing stores; neither should invent a new identity system.
- **Mock surface removal:** cage #1/#2 behind an explicit build/lint rule or delete once integration suites are re-pointed; make `DEV_AUTH_MOCK` env-driven default-false.

---

## 10. Sequencing recommendation

1. **Bootstrap runbook + statement tooling (Option D + B-shaped helper) should PRECEDE the next V1 implementation task.** Rationale: every remaining operational task (limits/commercial configuration drills, agent onboarding pilots, reconciliation ops) presumes a legitimately-authenticated workforce; the gap today is only *operational usability* of an approved mechanism, and the fix is small, non-invasive, and zero-risk to financial code.
2. **Agent credential issuance** should be the immediately following engineering item — it is the smallest delta that removes manual DB manipulation from the only V1 actor (agent) whose *entire* V1 feature set (A21, history, C2C, funding) is otherwise complete but unreachable in production.
3. **Customer creation/credential decision** gates customer-side production onboarding; recommend it be decided alongside the aggregator self-service decision (both are product-scope calls) rather than implemented ad hoc.
4. Mock-bypass removal can ride any hardening task; not a blocker.

---

*Audit completed against repository state at the baseline above. No secrets are reproduced; all playground values referenced only by location/pattern.*
