# V1-OPS-01 — Workforce Support Provisioning & Operational Workflow: Audit + Completion Report

**Branch:** `arena/01a10374-monienaija`

---

## 1. Starting HEAD

`aed355d` — `docs(V1): add V1-TEST-02 rule registry concurrency audit report`

## 2. Final HEAD

`672ba67` — `feat(workforce): complete support operational workflow`

---

## 3. Existing workforce architecture (as found, before this task)

Three independent, per-principal-type identity/session stacks already existed:

| Principal type(s) | Identity store | Session issuer | Notes |
|---|---|---|---|
| CUSTOMER | `customer_authentication_credentials` | `AuthenticationSessionService` | Mature, MFA-capable |
| AGENT | `agent_authentication_credentials` | `AgentAuthenticationSessionService` | Mature, credential rotation, MFA |
| OPERATOR / PRIVILEGED (and schema-reserved FINANCE_ADMIN/PREPARER/CONTROLLER/AUDITOR) | External OIDC + `A2_FINANCE_ROLES_JSON` | `A2WorkforceSessionService` | Provider-neutral OIDC exchange, mandatory MFA, maker/checker. Role vocabulary is **schema-locked** to exactly the four A2T11 finance governance roles |
| **SUPPORT** | **none** | **none** | `AuthorizationPrincipalType` already declared `'SUPPORT'`, and every `/internal/*` route policy (e.g. `capability-policy.service.ts`, `support.service.ts`'s `assertWorkforcePrincipal`, `customer-financial-account-read.service.ts`) already listed SUPPORT in `allowedPrincipalTypes` — but **no code path anywhere in the codebase could ever construct a principal of type SUPPORT**. `A2WorkforceSessionService.validate()` only ever returns `OPERATOR` or `PRIVILEGED`, and the A2 Finance role vocabulary structurally cannot accept a fifth "SUPPORT" role key. |

This reconfirms, against the current repository at `aed355d`, that the historical "SUPPORT sessions not issuable" finding was **still true**: SUPPORT was real in the type system and in every permission check, but had no provisioning or authentication surface at all. Test `test/v1-customer-09-support-workforce-boundary.integration.spec.ts` (pre-existing) proved this explicitly by using a synthetic `Bearer workforce-<TYPE>` override to exercise the *permission logic* for a hypothetical SUPPORT principal — its own comment says "In production today only OPERATOR and PRIVILEGED are ever actually issued."

`src/support/support.service.ts` required **zero** changes: `assertWorkforcePrincipal`/`assertPrincipal` and every ticket/message/status/assign/list method already treat SUPPORT identically to OPERATOR/SERVICE/PRIVILEGED. The gap was purely at the identity/issuance layer, not the authorization-boundary layer.

---

## 4. Provisioning path (implemented this task)

New, deliberately minimal, deliberately **separate** identity/session pair — mirroring the existing per-domain Agent/Customer pattern rather than extending the schema-locked A2 Finance stack:

- **Migration** `src/migrations/1785753600081-CreateSupportWorkforceAuthentication.ts` — creates `support_workforce_users` and `support_workforce_sessions` (CHECK constraints, unique partial index on active username, FK session→user `ON DELETE RESTRICT`).
- **`SupportAuthenticationService.provision(username, actor)`** — generates a CSPRNG temporary password (`randomBytes(12)`, base64url), hashes it with PBKDF2 (10,000 iterations, random salt, format `PBKDF2$sha256$<iter>$<salt>$<hash>`), sets a 72-hour expiry, and returns the **one-time plaintext** to the caller only. The plaintext is never persisted or logged; audited as `SUPPORT_WORKFORCE_USER_PROVISIONED` with no secret in the audit payload (verified by test).
- **`AdminSupportCredentialsController`** (`POST /internal/admin/support/workforce-users`, `.../:id/disable`, `.../:id/enable`) is the **only** path in the codebase that can create or change a SUPPORT identity. It requires an actor of type OPERATOR, SERVICE, or PRIVILEGED (`requireOperational()`), exactly mirroring `AdminAgentCredentialsController`. CUSTOMER, AGENT, AGGREGATOR, and **SUPPORT itself** are explicitly denied — proven by real-HTTP tests 1, 2, and 6 in the new integration suite (Section 13/14).
- This is enforced **twice**: once in the controller (`requireOperational()`), and again at the route-policy layer (`route-policy-registry.ts`, new explicit entry for `/internal/admin/support/workforce-users*` restricting `allowedPrincipalTypes` to `['OPERATOR','SERVICE','PRIVILEGED']`), as defense in depth — matching the existing pattern for agent/customer credential issuance.
- There is **no bootstrap/self-service SUPPORT role-assignment endpoint anywhere**. An authorized higher-privilege operator (OPERATOR/SERVICE/PRIVILEGED — i.e. an already-provisioned A2 workforce identity) remains solely responsible for provisioning SUPPORT, satisfying the task's standing constraint.

---

## 5. Authentication path (implemented this task)

- **`POST /internal/support/workforce-sessions`** (`SupportAuthenticationController.login`) — unauthenticated route (new `SUPPORT_LOGIN` mode in `route-policy-registry.ts`, mirroring `AGENT_LOGIN`/`CUSTOMER_LOGIN`). Accepts `{ username, password }`.
  - Username is normalized to lowercase before lookup.
  - For an **unknown username**, a dummy PBKDF2 computation still runs before rejecting, so an unknown-username response takes a comparable code path to a wrong-password response (reduces trivial timing-based username enumeration); both return the identical `401` message (proven by test 4b).
  - Checks: credential verified (PBKDF2 + `timingSafeEqual`), user status `ACTIVE`, temporary-password not expired.
  - On success: issues a 15-minute session (`randomBytes(32)` token, SHA-256 token hash stored, never the raw token), audits `SUPPORT_WORKFORCE_LOGIN_SUCCEEDED`, and returns the real `AuthorizationPrincipal` shape (`type: 'SUPPORT'`, `roles: ['SUPPORT']`, `scopes: ['support:ticket:read','support:ticket:reply','support:ticket:status']`, `customerAccess: 'NONE'`, `assuranceLevel: 'PASSWORD'`) alongside the bearer token.
- **`RuntimeAccessGuard`** (`WORKFORCE_SESSION` route mode): tries the existing A2 workforce session validation first (unchanged); on failure, falls back to `SupportAuthenticationService.validate(token)` before falling through to the existing Agent/Customer-wrong-token-type rejection logic. This is the exact mechanism that makes a real, HTTP-issued SUPPORT bearer token usable on every existing `/internal/*` route that already allowed SUPPORT in its policy — **no route-policy allow-list needed to change**, because SUPPORT was already allow-listed everywhere; only the *validation* path was missing.
- **`SupportAuthenticationService.validate(token)`**: looks up by SHA-256 token hash, checks session status `ACTIVE` and not expired (lazily marks `EXPIRED` on expiry rather than leaving a stale `ACTIVE` row), and **re-checks the owning user's status is `ACTIVE`** as defense-in-depth even though `disable()` already eagerly revokes all active sessions for that user — closing the theoretical race where a session is validated in the same instant a disable transaction commits.
- No MFA step exists for SUPPORT (password-only, `assuranceLevel: 'PASSWORD'`) — this matches the task's "smallest secure V1 mechanism" instruction and is explicitly weaker than the A2 Finance stack (MFA-mandatory), which is appropriate because SUPPORT's authorized scope (Section 6) excludes every MFA-gated / high-assurance operation in this codebase.
- Session revocation: `DELETE /internal/support/workforce-sessions/:id` — self (the session's own owner) or any OPERATOR/SERVICE/PRIVILEGED actor; a different SUPPORT user cannot revoke someone else's session (no IDOR).

All of the above was proven through **real HTTP calls against a real PostgreSQL-backed NestJS application** (not direct service calls, not a synthetic principal) in the new integration suite — see Section 7/14.

---

## 6. Authorization boundaries (real HTTP, proven)

Using a **genuinely issued** SUPPORT bearer token (never a synthetic `workforce-SUPPORT` override):

**ALLOWED** (test 4, 5):
- `GET /internal/support/tickets`, `GET /internal/support/tickets/:id` (queue visibility — see Section 8 for the intentional no-per-ticket-filter design).
- `POST /internal/support/tickets/:id/messages` (customer-visible reply, and internal-only notes).
- `POST /internal/support/tickets/:id/status` (ticket status transitions).

**DENIED** (test 6):
- `POST /internal/admin/support/workforce-users` (provisioning another/itself) → `403`.
- `POST /internal/admin/agents/:id/suspend` (agent lifecycle / operational action) → `403` — the actor check in `AdminAgentLifecycleController.requireOperational()` runs before any entity lookup, so this boundary is proven even against a non-existent agent id.

These two denials are representative of the broader, **pre-existing** and unchanged boundary already enforced throughout `admin/*` controllers via `requireOperational()`/`requireWorkforce()`-style checks that explicitly exclude SUPPORT: balance/financial operations, PIN changes/resets, OTP or cash-to-cash bypass, KYC decisions, suspension removal, commercial-rule/limit changes, ADMIN or Agent credential issuance. None of this logic was touched by this task — SUPPORT was already correctly excluded from all of it; what was missing was only the ability to *obtain* a SUPPORT session to exercise the boundary for real, which this task now provides and has used to prove the boundary with real HTTP rather than a role-enum inspection.

---

## 7. Full-flow proof (real PostgreSQL + real HTTP)

New suite `test/v1-ops-01-support-workforce-operational.integration.spec.ts` (13 tests, all passing) exercises the complete lifecycle end-to-end:

1. OPERATOR (A2 workforce) provisions SUPPORT → one-time temporary password returned, hash stored (never the plaintext), audited.
2. SUPPORT logs in for real (`POST /internal/support/workforce-sessions`) → real bearer token.
3. That exact token is used to list/view a ticket, post a customer-visible reply, post an internal-only note, and change ticket status.
4. The ticket's own customer (separately registered and logged in, real HTTP) sees the public reply on `GET /customers/me/support/tickets/:id/messages` and **never** sees the internal note (Part F boundary).
5. A retried reply with the same `Idempotency-Key` header does not create a duplicate row (Part I).
6. Disabling the SUPPORT user immediately revokes the session; the next request with the old token is `401`; the DB row is observed as `REVOKED`.
7. Login for a disabled user is rejected even with the correct password; re-enabling restores login.
8. A backdated `expires_at` causes the next validation to reject and lazily mark the session `EXPIRED` in the database.
9. Explicit self-revocation (`DELETE /internal/support/workforce-sessions/:id`) immediately invalidates the token.

---

## 8. Escalation findings

- SUPPORT cannot provision itself or any other SUPPORT identity — proven with a real SUPPORT session attempting the real provisioning endpoint (test 6): `403`.
- SUPPORT cannot reach an operational/financial admin action (agent suspend) — proven with a real SUPPORT session (test 6): `403`.
- SUPPORT cannot revoke another identity's session (service-level check: only the session's own owner, or OPERATOR/SERVICE/PRIVILEGED, may revoke).
- `listForInternal`/`getForInternal` (the internal ticket queue) have **no per-ticket ownership filter for workforce** — any workforce principal (SUPPORT, OPERATOR, SERVICE, PRIVILEGED) can view/list any ticket. This was investigated as a possible IDOR and determined to be an **intentional support-queue design**, not a gap: customer- and agent-facing self-service endpoints (`getForCustomer`, `getForAgent`) do enforce ownership; the internal queue is deliberately shared across the workforce so any available agent can pick up any ticket. No fix applied (would be out of scope to change this architecture without a confirmed gap, per the task's standing instruction).
- No client-supplied role/principal-type field exists anywhere on the SUPPORT login or any workforce request path — the principal is derived entirely server-side from the validated session row.
- Role-removal semantics: SUPPORT has no separate "role" distinct from its identity (the identity itself *is* the SUPPORT type); the equivalent of role removal is `disable()`, which eagerly revokes every active session for that user (Section 9), so there is no stale-session-after-role-change window to exploit.

---

## 9. Status / session findings

Observed (not invented) behavior, proven against real session rows:

| Transition | Behavior |
|---|---|
| User disabled while session active | Session immediately flips to `REVOKED` in the same operation; subsequent requests with that token → `401` |
| Login attempt against a disabled user | `401`, even with the objectively correct password |
| User re-enabled | A **new** login is required and succeeds; no previously revoked session is resurrected |
| Session `expires_at` reached | Next validation attempt rejects (`401`) and lazily flips the row to `EXPIRED` (not left dangling as `ACTIVE`) |
| Explicit `DELETE` revocation | Session flips to `REVOKED` immediately; token unusable on the very next request |
| Concurrent disable/enable | CAS via `repo.update({id, version}, {..., version: version + 1})` — the exact proven pattern already used by `CommissionRuleRegistryService`; a concurrent conflicting write raises `409 Conflict` rather than silently losing an update |

---

## 10. Audit-trail findings

No new audit framework was built — the existing `AuditService.record(manager, command)` (with automatic `redactRecord()` sanitization of `previousValues`/`newValues`) was reused exactly as-is, the same as every other domain in this codebase. Events recorded, with actor/action/target/timestamp, and verified by test to contain **no plaintext secret**:

- `SUPPORT_WORKFORCE_USER_PROVISIONED` (actor = provisioning OPERATOR/SERVICE/PRIVILEGED id; target = new SUPPORT user id; `newValues` contains only username/status/expiry, never the temporary password — verified by asserting the serialized audit payload does not contain the plaintext password).
- `SUPPORT_WORKFORCE_USER_DISABLED` / `SUPPORT_WORKFORCE_USER_ENABLED`.
- `SUPPORT_WORKFORCE_LOGIN_SUCCEEDED` (actor = the SUPPORT user id; target = the new session id).
- `SUPPORT_WORKFORCE_SESSION_REVOKED` (actor = the revoking principal; target = the session id; records the human-supplied reason).

Pre-existing ticket-level audit logging (reply/status/assign) in `support.service.ts` was not modified and continues to capture actor type/id, action, target ticket, and timestamp as before.

---

## 11. Idempotency findings

Reused the existing `IdempotencyService` exclusively — no new idempotency mechanism was introduced anywhere in this task.

**Genuine gap found and fixed:** `SupportInternalController`'s reply endpoint (`POST /internal/support/tickets/:id/messages`) had **no `Idempotency-Key` header wiring at all**, unlike `support-customer.controller.ts` and `support-agent.controller.ts`, both of which already read the header and pass it through to `SupportService.addMessage()` (which already fully implements idempotency reserve/replay/complete via `IdempotencyService`, proven correct for the customer path in V1-CUSTOMER-09). The fix mirrors the exact existing header-read pattern (`Headers('idempotency-key')` / `Headers('Idempotency-Key')`, lower/upper-case header tolerance) onto the internal endpoint — three lines of wiring, zero new logic. Proven by test 7 in the new suite: a retried reply with the same key returns the same message id and does not create a second row.

---

## 12. Exact genuine gaps found

1. **(P0, closed this task)** SUPPORT was unconditionally permitted by every authorization policy in the codebase but had **no provisioning or authentication mechanism** — the historical finding was reconfirmed true at `aed355d`.
2. **(P2, closed this task)** `SupportInternalController`'s reply endpoint had no `Idempotency-Key` wiring, unlike its customer/agent siblings.

No other genuine gap was found within the strictly-scoped SUPPORT operational-readiness search (Part L): no unenforced stored roles, no stale-token-after-role-change window (Section 8), no IDOR on workforce-user or session ids beyond the pre-existing intentional support-queue sharing (Section 8), no internal-note leakage to customers (Section 7, proven), no unauthorized role-assignment endpoint anywhere in the codebase.

---

## 13. Exact fixes implemented

- New migration `1785753600081-CreateSupportWorkforceAuthentication` (`support_workforce_users`, `support_workforce_sessions`).
- New module `src/support-authentication/` (enums, two entities, `SupportAuthenticationService`, `SupportAuthenticationController`, `SupportAuthenticationModule`).
- New `src/admin/admin-support-credentials.controller.ts` (provisioning, disable, enable).
- `src/admin/admin.module.ts` — registers the new controller and imports `SupportAuthenticationModule`.
- `src/authorization/authorization.module.ts` — imports `SupportAuthenticationModule` so `RuntimeAccessGuard` can inject it.
- `src/authorization/runtime-access.guard.ts` — SUPPORT session fallback inside the `WORKFORCE_SESSION` branch; new `SUPPORT_LOGIN` pass-through mode.
- `src/authorization/route-policy-registry.ts` — new `SUPPORT_LOGIN` authentication mode; explicit route-policy entries for the SUPPORT login route and the admin SUPPORT-provisioning routes (OPERATOR/SERVICE/PRIVILEGED only).
- `src/app.module.ts` — registers `SupportAuthenticationModule` at the top level for graph clarity (it was already transitively reachable via `AdminModule`/`AuthorizationModule`).
- `src/support/support-internal.controller.ts` — `Idempotency-Key` header wiring on the reply endpoint, mirroring the customer/agent controllers exactly.

No provisioning-architecture change beyond the above (Part A instruction honored): the new mechanism is additive and scoped to SUPPORT only, and does not touch the A2 Finance stack, Agent credentialing, or Customer authentication in any way.

---

## 14. Tests added / changed

**Added:**
- `test/v1-ops-01-support-workforce-operational.integration.spec.ts` — **new, 13 tests**, real PostgreSQL + real HTTP, no synthetic SUPPORT principal injection for the identity under test (the ADMIN/OPERATOR actor still uses the established `Bearer workforce-OPERATOR` A2 mock, exactly as `test/v1-agent-credentials-01.integration.spec.ts` already does for the Agent-credentialing equivalent).

**Changed (mechanical, required by the new migration):**
- `test/runtime-access.guard.spec.ts` — unit test fixture updated for `RuntimeAccessGuard`'s new constructor parameter (`SupportAuthenticationService` mock).
- 16 pre-existing real-PG integration specs had their "latest migration in chain" assertions extended to accept migration `1785753600081` (the new migration is the 82nd in an append-only chain; these specs assert the latest migration timestamp/name belongs to a known-good allowlist, a pattern already established and extended by every prior additive migration in this repository): `a17-agent-cash-to-cash-expiry`, `a18-aggregator-foundation`, `a19-agent-funding`, `a20-outlets-terminals`, `a8-agent-lifecycle`, `v1-001-customer-funding`, `v1-003-admin-operational-writes`, `v1-005-notification-delivery`, `v1-006-customer-notification-inbox`, `v1-007-support-ticket`, `v1-capability-registry` (exact-count assertions bumped 81→82), `v1-hardening-07-admin-agent-financial-position`, `v1-hardening-09-admin-notification-delivery-diagnostics`, `v1-limit-01-limit-catalogue`, `v1-limit-02-limit-assignment`, `v1-limit-03-limit-usage` (exact-match assertions updated to the new head).
- `test/migration-chain.integration.spec.ts` required **no change** — it computes its expected migration count dynamically from `readdirSync(src/migrations)`.

**Untouched and still green:** `test/v1-customer-09-support-workforce-boundary.integration.spec.ts` (36 tests, synthetic-principal permission-boundary coverage) and `test/v1-007-support-ticket.integration.spec.ts` (ticket lifecycle + reply idempotency) — both exercised unmodified by the full regression run below.

---

## 15. Exact test counts

| Suite | Suites | Tests | Result |
|---|---|---|---|
| Unit (`npm test` / `jest`) | 173 | 1,803 | all pass |
| Real-PostgreSQL integration (`npm run test:pg`) | 83 | 1,653 | all pass |
| **Total** | **256** | **3,456** | **all pass** |

Of the 1,653 integration tests, 13 are the new `v1-ops-01-support-workforce-operational.integration.spec.ts` suite; the remaining 1,640 are pre-existing suites (82 files before this task), all confirmed still passing after the migration-chain allowlist updates in Section 14.

---

## 16. Full regression results

Both suites were executed in full against a disposable, freshly-migrated PostgreSQL instance (the repository's own `embedded-postgres`-backed harness, started via `scripts/embedded-pg.js`), using the repository's standard `npm test` and `npm run test:pg` entry points (`jest --runInBand` / `jest --config jest.integration.config.js --runInBand`):

```
Unit:        Test Suites: 173 passed, 173 total | Tests: 1803 passed, 1803 total
Integration: Test Suites:  83 passed,  83 total | Tests: 1653 passed, 1653 total
```

`npx tsc --noEmit` is clean. `npx eslint "{src,test}/**/*.ts"` reports the identical pre-existing 1,278 problems (1,228 errors / 50 warnings) before and after this task's changes — confirming zero new lint issues were introduced anywhere in the codebase; the new files and the migration-allowlist edits lint cleanly on their own.

One pre-existing, unrelated flaky test was observed during a full-file-list run of the integration suite (`test/v1-commercial-02-product-catalogue.integration.spec.ts`, test 08, an optimistic-concurrency race test unrelated to SUPPORT/workforce) and confirmed to pass reliably (3/3) when run in isolation; it is a known timing-sensitive interaction under the embedded-postgres harness and is out of this task's scope to fix (unrelated commercial-catalogue/DB-concurrency code, explicitly forbidden scope).

---

## 17. Remaining operational gaps

These are observations, not blockers, and are explicitly **not** fixed in this task because they are outside its scope or do not rise to a confirmed P0/P1 gap:

- SUPPORT authentication is password-only (no MFA option). This is an intentional, scope-appropriate trade-off given SUPPORT's narrow, non-financial scope, but a future hardening task could add an optional step-up if SUPPORT's permitted scope ever grows.
- There is no credential-rotation/forced-password-change flow for SUPPORT (the temporary password simply expires after 72 hours with no automated reminder or rotation UI) — Agent/Customer have richer rotation flows; SUPPORT's is the minimum viable version appropriate for a V1 workforce-of-one-kind-of-action identity.
- No admin UI exists for SUPPORT provisioning — it is an API-only control-plane surface today, consistent with how Agent/Customer credential issuance is also API-only in this codebase.
- The internal support ticket queue remains deliberately shared across all workforce principals with no per-agent assignment-based read restriction (Section 8) — this is an existing, intentional design decision, not a new gap, and is flagged here only for completeness per the Part L unknown-unknown mandate.

---

## 18. Recommended next task

A focused **SUPPORT credential lifecycle hardening** task: optional forced password rotation on first login (mirroring the Agent first-login rotation flow already proven in V1-AGENT-CREDENTIALS-01), plus a lightweight admin listing/search endpoint for existing SUPPORT workforce users (list/filter by status), so operational teams can audit who currently holds SUPPORT access without querying the database directly. This is a natural, narrowly-scoped follow-on to the identity primitives this task introduced, and does not require touching authorization boundaries, ticket logic, or any forbidden-scope area.

---

## Final status

**B. SUPPORT OPERATIONAL WORKFLOW VERIFIED — P0/P1 FIXES IMPLEMENTED**
