# V1-HARDEN-01 — Support Authentication Surface: Adversarial Security Hardening Audit

## 1. Starting HEAD

`b55a0e2f672a5484c271fc3be99c20f3b7e96eac` — "docs(V1): add V1-OPS-01 workforce support operational workflow audit", on branch `arena/01a10374-monienaija`.

## 2. Final HEAD

The code-change commit is `818feac` — "security(workforce): harden support authentication" (8 files changed, 1180 insertions(+), 49 deletions(-)) — containing all fixes and new tests described below. This document is committed immediately after it, as a separate commit on the same branch (`arena/01a10374-monienaija`), per the task's commit-discipline requirement to keep the code commit message exactly `security(workforce): harden support authentication` and the docs commit separate. The final HEAD of the branch is therefore this document's own commit, one commit after `818feac`.

## 3. Scope

This audit re-examines, adversarially and from the position of seven threat models (unauthenticated attacker; malicious Customer/Agent; compromised SUPPORT account; lower-privileged workforce user; attacker holding an old/revoked session; attacker who knows another user's identifier; concurrent/replay attacker), the entire SUPPORT workforce authentication surface introduced by V1-OPS-01:

- `support_workforce_users`, `support_workforce_sessions` (schema, constraints, indexes)
- `SupportAuthenticationService` (`src/support-authentication/support-authentication.service.ts`): `provision`, `login`, `validate`, `disable`, `enable`, `revokeSession`
- `AdminSupportCredentialsController` (`src/admin/admin-support-credentials.controller.ts`) and the internal support HTTP endpoints it and `SupportTicketController`/`CapabilityRegistryController` expose
- `RuntimeAccessGuard`'s `WORKFORCE_SESSION` branch and its SUPPORT fallback (`src/authorization/runtime-access.guard.ts`)
- Two known adjacent items flagged for inclusion: the `A2SecurityRateLimitService` SERIALIZABLE-transaction path, and the limit-catalog `isUniqueViolation`-without-`isCheckViolation` asymmetry

No bank/NIBSS, external payouts, cards, bills, W2C Method 2, rewards, push notifications, EAS, mobile UI features, CRM, AI support, KYC redesign, broad workforce redesign, Expo/RN version changes, blind dependency upgrades, or unrelated refactoring were performed, per the task's explicit exclusions. The authentication *model* (separate per-principal-type credential/session stores, mirroring Agent/Customer) was not redesigned — no defect was found that required it.

All claims below trace the **actual production code path** (service methods, controller guards, route-policy-registry entries) that a real HTTP request executes — not merely the existence of a unit test.

## 4. Password lifecycle (Part A)

Traced `generateTemporaryCredential()`, `verifyPassword()`, and `login()`/`provision()` end-to-end:

- Temporary passwords are generated server-side only, via `randomBytes(12)` (96 bits of CSPRNG entropy), base64url-encoded. There is **no self-service password-choice path anywhere in the codebase** for SUPPORT — provisioning always produces a fresh random credential; there is no "change password" endpoint.
- Stored as `PBKDF2$sha256$10000$<salt>$<derivedHash>`, 10,000 iterations, 32-byte derived key, 16-byte random salt per credential — consistent with the existing Customer/Agent credential-hashing convention in this codebase.
- `verifyPassword()` uses `timingSafeEqual` for the digest comparison.
- `TEMPORARY_PASSWORD_TTL_MS` = 72 hours, enforced in `login()` (`row.passwordExpiresAt <= now` → 401 "Support credential has expired").
- No redesign of this model was made or is recommended: the only plausible attack against a 96-bit CSPRNG secret with no self-service rotation is credential theft out-of-band, which is outside this audit's scope (network/transport/device compromise). **Closed, no finding.**

## 5. Login abuse / brute force (Part B)

New regression: `test/v1-harden-01-support-adversarial.integration.spec.ts`, `describe('Part B — login abuse')`.

- 20 sequential wrong-password attempts against one real, provisioned SUPPORT account, followed by a 3-way concurrent burst: every attempt returns `401`, none returns `429` or `5xx`, and the correct temporary password still authenticates immediately afterward. **Confirmed finding (not fixed): unlike `CustomerAuthenticationService`/`AgentAuthenticationService` (which both lock an account after 5 failed attempts), `SupportAuthenticationService.login()` has no failed-attempt lockout counter.** This is downgraded to **P2, not fixed**, because the only credential a SUPPORT account can ever have is a 96-bit CSPRNG temporary password with no self-service choice — brute-forcing the actual secret space is computationally infeasible regardless of a lockout, so a lockout here would add defense-in-depth consistency but closes no realistically exploitable gap. Documented as a recommendation (§22/§23), not implemented, per the instruction not to invent a new rate-limit system and to prefer minimal, demonstrated fixes.
- A mixed probe (two nonexistent usernames, one disabled-but-correct-password account, one wrong-password account) run concurrently: all four return exactly the same `401` status and the same response body message (enumeration-resistance check, see also §11). **No finding.**

## 6. Session security (Part C)

Traced `login()`/`validate()`/`revokeSession()` directly:

- **Token generation:** `randomBytes(32).toString('base64url')` — 256 bits of CSPRNG entropy per session token. Not a JWT; opaque and unguessable.
- **Token storage:** only `sha256(token)` (`tokenHash`) is persisted in `support_workforce_sessions`; the plaintext token is returned to the client once and never stored. A DB compromise alone does not yield usable session tokens.
- **Expiry:** `SESSION_TTL_SECONDS = 900` (15 minutes). `validate()` checks `session.expiresAt <= now` and transitions the row to `EXPIRED` before rejecting — an expired token is never silently accepted.
- **Revocation:** `disable()` immediately transitions every `ACTIVE` session for that user to `REVOKED` in the same call (verified live in §10's race test: a session rejected mid-flight during a concurrent `disable()` always ends in a consistent `REVOKED` state, never a crash or inconsistent intermediate state).
- **Cross-account revocation (IDOR):** `revokeSession()` only allows `isSelf` (same `principal.sessionId`) or `isPrivilegedWorkforce` (`OPERATOR`/`SERVICE`/`PRIVILEGED`) to revoke a session — verified live with two real, independently provisioned+authenticated SUPPORT accounts: user A's attempt to revoke user B's session is denied `403` and B's session remains fully usable afterward (`test/v1-harden-01-support-adversarial.integration.spec.ts`, `Part E/G`).
- **Post-disable defense-in-depth:** `validate()` independently re-checks `user.status === ACTIVE` even though `disable()` already revokes sessions, covering the instant-of-disable race explicitly.

No session-security P0/P1/P2 found. **Closed, no finding; regression added for the revocation IDOR and the disable-race as part of Parts E/G below (same test file).**

## 7. RuntimeAccessGuard WORKFORCE_SESSION boundary (Part D)

**Finding identified, investigated in depth, confirmed NOT currently exploitable, left unfixed, documented as a defense-in-depth recommendation.**

`RuntimeAccessGuard`'s `WORKFORCE_SESSION` branch authenticates an A2 or SUPPORT workforce bearer token and sets `request.authorizationPrincipal`, but **never itself consults `route.policy.allowedPrincipalTypes` before returning `true`.** It relies entirely on each controller re-checking `principal.type` on its own.

Investigation traced every controller reachable behind a `route-policy-registry.ts` entry that restricts a `WORKFORCE_SESSION` route to `OPERATOR`/`SERVICE`/`PRIVILEGED` (excluding SUPPORT) and found each one performs its own redundant principal-type check:
- `LimitCatalogController.requireWorkforce()` — throws 403 for any non-OPERATOR/SERVICE/PRIVILEGED principal, confirmed by direct code read (`src/limit-catalog/limit-catalog.controller.ts`).
- `AdminSupportCredentialsController` — explicit `principal.type` allow-list (`src/admin/admin-support-credentials.controller.ts` lines ~83-94), throwing `ForbiddenException('Operational access required')`.
- The customer-lifecycle `PATCH /customers/:id` handler has its own dedicated, deliberately-SUPPORT-excluding check (documented inline in the registry as a prior "UAT-DEFECT-001 fix").
- Product/fee/commission/reward-rule controllers follow the identical pattern.

**A guard-level enforcement fix was prototyped and then reverted** after it measurably broke five unrelated, pre-existing, already-passing integration suites (`a22-admin-foundation`, `v1-hardening-09-admin-notification-delivery-diagnostics`, `v1-capability-registry`, `v1-customer-onboarding-02`, `s-fix-01-customer-lifecycle-authorization`) by changing their deliberately-asserted status codes (401→403) for wrong-type A2 principals — without closing any gap those controllers had not already closed themselves. A decisive `git stash` experiment proved this directly: with the guard-level change fully removed, a dedicated boundary-proof test (`test/v1-harden-01-runtime-access-guard-boundary.integration.spec.ts`) still passed 3/3 against a **real, provisioned-and-authenticated** SUPPORT session, because the controllers behind every sampled route already deny it independently.

Per the task's instruction not to make undemonstrated, broad changes to the mature A2 authorization path, this guard-level change was **not applied**. The structural gap (the guard not duplicating what every controller already does) is recorded here and in §22/§23 as a recommendation for a dedicated future task, with its own full regression pass, rather than bundled into this one.

**Regression:** `test/v1-harden-01-runtime-access-guard-boundary.integration.spec.ts` — proves, with a real HTTP stack and a real provisioned+authenticated SUPPORT session (no synthetic principal injection), that (1) every sampled SUPPORT-excluded route is denied today, (2) SUPPORT remains allowed on its permitted routes, (3) OPERATOR remains allowed on the same routes SUPPORT is denied — proving the denial is principal-type-specific, not an accidental blanket lockout.

## 8. Privilege escalation (Part E)

Verified via real HTTP, real provisioned accounts (`test/v1-harden-01-support-adversarial.integration.spec.ts`, `Part E/G`):

- A real SUPPORT session cannot disable or enable **any** workforce user, including itself (`403` on all three probes: disable-other, disable-self, enable-other).
- A crafted request body/headers claiming an elevated principal type or role (`X-Principal-Type: OPERATOR`, `X-Role: PRIVILEGED`, and matching body fields) is ignored — authorization is derived solely from the server-validated bearer token, confirmed against both the support-user-provisioning endpoint and an unrelated agent-admin endpoint (`403` in both cases).
- Cross-account session revocation (IDOR) is denied — see §6.

No privilege-escalation P0/P1/P2 found. **Closed, no finding; regression added.**

## 9. Provisioning security (Part F)

**Finding confirmed and fixed.** `provision()`'s existence pre-check (`findOne`) and its insert are not atomic: two concurrent `provision()` calls for the same username can both pass the pre-check and race on the database's partial unique index (`uq_support_workforce_users_username_active`). Before the fix, the losing transaction's unique-violation was not caught, surfacing as a raw, uncaught `QueryFailedError` instead of the `ConflictException` the non-racing duplicate path already returns. `GlobalExceptionFilter` (`src/http-exception.filter.ts`) redacts any 5xx to a generic "Internal server error" for the client, so this was **not an information-disclosure defect** — it was a correctness/availability defect (an avoidable 500 for what is really a benign duplicate-identity condition). Classified **P2**.

**Fix:** wrapped the insert in a `try/catch` that detects a `23505` unique-violation (`isUniqueViolation`, mirroring the existing pattern in `LimitCatalogService`) and converts it to the same `ConflictException` the pre-check already throws. No idempotency mechanism was added (per the instruction not to add idempotency merely because it is possible) — this is strictly a correctness fix for an existing, intended duplicate-rejection contract.

**Regression:** `test/v1-harden-01-support-provision-race.integration.spec.ts` — 8 genuinely concurrent `provision()` calls for the same username against real PostgreSQL: exactly 1 fulfills, 7 reject, and every rejection is `instanceof ConflictException` and explicitly `not.toBeInstanceOf(QueryFailedError)`. Before the fix this reliably produced raw `QueryFailedError` rejections instead.

No other provisioning defect found (provisioning requires an already-authenticated OPERATOR/SERVICE/PRIVILEGED principal; SUPPORT has no path anywhere to provision or elevate any workforce identity — confirmed by code read and by the Part E self-escalation tests above). **Otherwise closed.**

## 10. Enable / disable / revoke (Part G)

Verified via real HTTP, real concurrency (`test/v1-harden-01-support-adversarial.integration.spec.ts`, `Part C/G`):

- `disable()` uses optimistic concurrency (`version` column) — a `WHERE id = ? AND version = ?` update that throws `ConflictException` on a lost race, not a lost update.
- `disable()` immediately cascades to revoke every `ACTIVE` session for that user in the same call (not eventually-consistent).
- **Live race test:** a real `disable()` call fired concurrently with 5 in-flight authenticated requests on the same session never produces a `500` or an inconsistent state — every concurrent request resolves to either `200` (raced ahead) or `401` (observed the disable), and the final DB state is deterministically consistent (`user.status = DISABLED`, `session.status = REVOKED`), with the token rejected on every subsequent use.
- `enable()`/`disable()` both correctly reject non-privileged callers (see §8).

No P0/P1/P2 found. **Closed, no finding; regression added.**

## 11. Account enumeration (Part H)

- `login()` performs a PBKDF2 comparison (10,000 iterations) **even for an unknown username** (`pbkdf2Sync(password, randomBytes(16), ...)` against a throwaway salt), specifically to avoid a cheap-vs-expensive timing oracle distinguishing "unknown username" from "wrong password."
- Unknown username, wrong password, and known-but-disabled-account all return the exact same HTTP status (`401`) and the exact same response body message — verified by a live probe comparing the message set across all three cases (`Set` of response messages has size 1).
- Failed-login auditing (added in §13) intentionally does **not** write an audit row for an unknown username (there is no real `support_workforce_users.id` to attach the NOT NULL `entityId` to), matching the identical convention already used by `CustomerAuthenticationService`/`AgentAuthenticationService` — this does not change the HTTP response or its timing, so it does not reintroduce an enumeration oracle. Verified live: the `SUPPORT_WORKFORCE_LOGIN_FAILED` audit count is unchanged after a failed login against a nonexistent username.

No enumeration P0/P1/P2 found. **Closed, no finding.**

## 12. Support data-boundary regression (Part I)

Re-verified against the (unchanged) guard fallback with a **real, provisioned-and-authenticated** SUPPORT session over real HTTP (`test/v1-harden-01-support-adversarial.integration.spec.ts`, `Part I`):

- `GET`/`PATCH /customers/:id` and `GET /customers/:id/kyc` all reject a SUPPORT bearer token (`401`/`403`).
- `GET /wallets/:id/balance` and `POST /transfers` both reject a SUPPORT bearer token.

This mirrors and re-confirms the pre-existing V1-OPS-01 data-boundary guarantee; no regression was introduced by this audit's (ultimately unapplied) guard-level prototype, since that prototype was fully reverted. **Closed, no finding.**

## 13. Auditability trace (Part J)

**Finding confirmed and fixed.** Tracing the full SUPPORT lifecycle (`provision`, `login` success/failure, `disable`, `enable`, `revokeSession`) against the existing `audit_events` table (reused — no second audit mechanism was created, per the instruction) found that `provision()`, `disable()`, `enable()`, and session-success/revoke were already audited, but **`login()` wrote no audit record at all on a failed attempt** (wrong password, disabled account, or expired credential) — a forensic blind spot: a compromised-or-probing actor's failed attempts against a known account left no trace, unlike `CustomerAuthenticationService`/`AgentAuthenticationService`, which both record `FAILED_AUTHENTICATION_RECORDED`-equivalent events. Classified **P2** (compliance/forensics gap, not a direct bypass).

**Fix:** `login()` now calls `AuditService.record()` (the existing service) with action `SUPPORT_WORKFORCE_LOGIN_FAILED` for every failed attempt against a **known** account (invalid credentials, disabled status, or expired credential), carrying a `reason` field. An unknown username is intentionally not audited, matching the identical Customer/Agent convention and preserving the enumeration-resistance property verified in §11.

**Regression:** `test/v1-harden-01-support-adversarial.integration.spec.ts`, `Part J` — drives a full real lifecycle (provision → failed login → disable → enable → login → self-revoke) and asserts the resulting `audit_events` rows contain `SUPPORT_WORKFORCE_USER_PROVISIONED`, `SUPPORT_WORKFORCE_LOGIN_FAILED`, `SUPPORT_WORKFORCE_USER_DISABLED`, `SUPPORT_WORKFORCE_USER_ENABLED`, `SUPPORT_WORKFORCE_LOGIN_SUCCEEDED`, and `SUPPORT_WORKFORCE_SESSION_REVOKED`, each with a non-empty `actor`, correct `entity_id`, and a timestamp; a second test confirms no audit row is fabricated for an unknown username.

## 14. Database / error-handling hardening (Part K)

- `GlobalExceptionFilter` (`src/http-exception.filter.ts`) redacts every `5xx` response to a generic `"Internal server error"` and runs `redactSensitiveText` on all `4xx` messages — confirmed this already fully covers the provisioning-race defect in §9 from an information-disclosure standpoint (it was a correctness/availability defect, never a leak).
- `SupportAuthenticationService` has no other unguarded raw-DB-error path: `login()`, `validate()`, `disable()`, `enable()`, and `revokeSession()` either query-then-branch (no write race) or already use optimistic-concurrency (`version`) updates with an explicit `ConflictException` on a lost race.

No DB/error-handling P0/P1/P2 beyond the §9 provisioning race was found. **Closed.**

## 15. Limit-catalog CHECK-constraint reachability (Part L)

**Closed, empirically confirmed non-finding, no code fix** — per standing instruction not to modify unrelated validation.

`limit_rules`/`limit_profiles`/`limit_assignments` carry PostgreSQL `CHECK` constraints (dimension enum, direction enum, amount-vs-count exclusivity, segment-code pattern, subject-type consistency). `LimitCatalogService`/`LimitAssignmentService` only special-case unique-violations (`23505`) in their catch blocks and would rethrow a raw `23514` CHECK violation unguarded — a structural asymmetry with the `isUniqueViolation` pattern. Tracing the **actual production path** (DTO `class-validator` decorators plus the service's own pre-insert/pre-update validation, re-run against the fully merged row state on every `PATCH`) shows every field with a DB `CHECK` constraint is already validated — with an equal or stricter rule — before the row ever reaches PostgreSQL.

**Regression:** `test/v1-harden-01-limit-catalog-check-constraint-boundary.integration.spec.ts` — fires adversarial payloads over real HTTP specifically designed to violate each CHECK constraint; every one is rejected with a clean `400` at or before the service layer, none produces a raw `500`/DB-error leak. This suite is a permanent guard: if a future change ever removes one of the pre-DB validations, the corresponding case here starts returning `500` instead of `400` and fails.

## 16. A2SecurityRateLimitService serialization/retry (Part M)

**Finding confirmed and fixed.** `A2SecurityRateLimitService.consume()` updates a shared token-bucket row under PostgreSQL `SERIALIZABLE` isolation with no retry on a transient `serialization_failure`/`deadlock_detected` (`40001`/`40P01`). Because a rate-limit bucket is, by design, a hot row many concurrent requests legitimately land on, this is exactly the traffic pattern `SERIALIZABLE` isolation is most likely to abort with a transient, expected-to-be-retried conflict. Reproduced directly against the service (no mocks): **10 concurrent `consume()` calls on one fresh bucket well under capacity produced 7/10 spurious `503`s**, even though the requests should have been allowed through. This is an availability defect in a security-relevant control (rate limiting) — a burst of legitimate concurrent traffic could itself trigger false-positive `503`s, functioning as an inadvertent denial-of-service against the rate limiter's own callers. Classified **P1** (security-control availability).

**Fix:** wired `runSerializableWithRetry` — an existing, already-used-elsewhere (A5 ledger post path, customer registration OTP verify) bounded 3-attempt retry helper for exactly this `40001`/`40P01` class of contention — around the bucket transaction. No new retry policy was introduced and no broader A2 refactor was performed, per the standing instruction.

**Regression:** `test/v1-harden-01-a2-rate-limit-serialization.integration.spec.ts` — realistic concurrency (2–3 simultaneous `consume()` calls on one fresh bucket, 15 trials each) produces zero spurious `503`s; the intentional `429` "rate limit exceeded" business outcome is proven unaffected by the retry wiring; a genuinely invalid rate-limit rule configuration still fails safely with `503` exactly as before; a disabled rule still never touches PostgreSQL.

## 17. Unknown-unknown search (Part N)

Beyond the enumerated parts, the following were specifically probed with no finding:
- **Timing side-channels:** `login()`'s unknown-username path performs an equivalent-cost PBKDF2 operation (§11); no other branch in the SUPPORT auth surface exposes a cheap/expensive timing split tied to a secret.
- **Replay of a revoked/expired token:** `validate()` rejects both explicitly (§6); no caching layer or secondary validation path bypasses this (only one `validate()` implementation exists and `RuntimeAccessGuard` calls it directly).
- **Type confusion between A2 and SUPPORT principals:** the A2 workforce path (`A2WorkforceSessionService.validate`) and the SUPPORT path (`SupportAuthenticationService.validate`) use entirely separate token formats/stores (OIDC-issued vs. internally-minted opaque token); a SUPPORT token cannot be presented to, or accepted by, the A2 validator and vice versa — confirmed by code read of both `validate()` implementations and by the guard's sequential try/catch structure (A2 attempted first, SUPPORT only on A2 failure).
- **Header/body spoofing of principal identity:** confirmed ineffective (§8).
- **SQL injection surface:** all SUPPORT-auth queries use parameterized TypeORM repository calls or parameterized raw queries (`$1`/`$2` placeholders) in both the service and every new test; no string-concatenated SQL was found in this surface.

No additional P0/P1/P2 found beyond §9, §13, §16 and the documented, unfixed structural finding in §7.

## 18. Vulnerabilities discovered

| # | Area | Description | Severity |
|---|------|--------------|----------|
| 1 | Provisioning (Part F) | Concurrent `provision()` race on duplicate username surfaced a raw, uncaught `QueryFailedError` (avoidable 500) instead of `ConflictException` | P2 |
| 2 | Auditability (Part J) | `login()` recorded no audit event on failed attempts against a known account — forensic blind spot | P2 |
| 3 | Rate limiting (Part M) | `A2SecurityRateLimitService.consume()` had no retry on transient SERIALIZABLE conflicts, producing spurious 503s under realistic concurrent load on a hot bucket row | P1 |
| 4 | Authorization (Part D) | `RuntimeAccessGuard`'s `WORKFORCE_SESSION` branch never itself enforces `route.policy.allowedPrincipalTypes` — relies entirely on each controller's own redundant check | Structural finding, confirmed **not currently exploitable** (every known controller behind such a route self-enforces); left unfixed, see §22/§23 |
| 5 | Login abuse (Part B) | No failed-attempt lockout counter on SUPPORT accounts, unlike Customer/Agent | P2, left unfixed (brute-forcing a 96-bit random secret is already infeasible) |
| 6 | DB error handling (Part L) | `isUniqueViolation`-without-`isCheckViolation` structural asymmetry in limit-catalog services | Confirmed **not reachable** via the real HTTP surface today (pre-DB validation already equal-or-stricter); left unfixed |

No P0 (immediately exploitable, critical-impact) defect was found anywhere in this audit.

## 19. Exact fixes implemented

1. **`src/support-authentication/support-authentication.service.ts`** — `provision()`: wrapped the insert transaction in try/catch, added `isUniqueViolation()` detecting PostgreSQL `23505`, converts a racing duplicate-username insert into the existing `ConflictException` contract instead of letting a raw `QueryFailedError` escape.
2. **`src/support-authentication/support-authentication.service.ts`** — `login()`: added `AuditService.record()` calls with action `SUPPORT_WORKFORCE_LOGIN_FAILED` for every failed attempt against a known account (invalid credentials, disabled status, expired credential), with a `reason` field; unknown usernames remain intentionally unaudited to preserve enumeration resistance.
3. **`src/authorization/security-rate-limit.service.ts`** — `consume()`: replaced the bare `this.ds.transaction('SERIALIZABLE', ...)` call with `runSerializableWithRetry(this.ds, 'a2-security-rate-limit-consume', ...)`, the existing bounded 3-attempt retry helper already used elsewhere for this exact class of transient conflict.
4. **`src/authorization/runtime-access.guard.ts`** — restructuring-only change (introduced a local `principal` variable so authentication and the eventual `return true` are separated); **no new enforcement behavior was added**. A substantial, dated comment documents the Part D investigation, the decision not to add guard-level policy enforcement, and the reasoning (§7), so a future reader/task has full context without re-deriving it.

No other production code was modified.

## 20. Tests added

| File | Suites covering | Tests | Result |
|------|------------------|-------|--------|
| `test/v1-harden-01-support-adversarial.integration.spec.ts` | Parts B, C/G, E/G, J, I | 10 | 10/10 pass |
| `test/v1-harden-01-runtime-access-guard-boundary.integration.spec.ts` | Part D | 3 | 3/3 pass |
| `test/v1-harden-01-support-provision-race.integration.spec.ts` | Part F | 1 | 1/1 pass |
| `test/v1-harden-01-a2-rate-limit-serialization.integration.spec.ts` | Part M | 5 | 5/5 pass |
| `test/v1-harden-01-limit-catalog-check-constraint-boundary.integration.spec.ts` | Part L | 6 | 6/6 pass |
| **Total new** | | **25** | **25/25 pass** |

Every test runs against **real PostgreSQL** (via `test/support/pg-harness.ts`, one dynamically-created database per suite, real migrations), **real HTTP** (Fastify + supertest), and in the concurrency tests, **genuinely concurrent** `Promise.all`/`Promise.allSettled` calls — no mocked database, no mocked concurrency, no synthetic principal injection into the request pipeline (every SUPPORT principal is produced by a real provision+login HTTP round trip). No existing test's assertions were weakened to make it pass.

## 21. Full regression results

All suites were re-run in full, fresh, in this environment (dependencies and the PostgreSQL server were reinstalled this session since the sandbox does not persist `node_modules` or system packages across turns; an embedded PostgreSQL 18 instance — `embedded-postgres` npm package — was used in place of Docker, which is unavailable in this sandbox; schema is created via the application's own real migrations through the existing test harness, identical to how `docker-compose.yml`'s PostgreSQL would be used):

| Suite | Result |
|-------|--------|
| Backend unit (`npx jest --runInBand`) | **173 suites, 1803 tests — 0 failures** |
| Backend PostgreSQL integration (`npx jest --config jest.integration.config.js --runInBand`) | **88 suites, 1678 tests — 0 failures** |
| Customer Mobile (`apps/customer-mobile`, `npx jest --watchAll=false`) | **12 suites, 92 tests — 0 failures** (one benign, pre-existing React `act()` warning in `SendMoneyScreen`, non-fatal) |
| Agent Mobile (`apps/agent-mobile`, `npx jest --watchAll=false`) | **17 suites, 233 tests — 0 failures** (same class of benign `act()` warning, non-fatal) |
| TypeScript (`npx tsc --noEmit -p tsconfig.json`) | **0 errors** |
| ESLint (`npm run lint`, scoped to the 8 files touched by this task) | New/edited test files and both non-guard source files (`security-rate-limit.service.ts`, `support-authentication.service.ts`): **0 errors, 0 warnings**. `runtime-access.guard.ts` retains the same 7 pre-existing `@typescript-eslint/no-explicit-any`/`no-unsafe-member-access`/`no-unsafe-assignment` errors it had **before** this task's edit (confirmed byte-for-byte identical via `git stash` A/B comparison against the original file) — this task introduced zero new lint errors anywhere it touched. The repository's full, unscoped `npm run lint` reports ~1,238 pre-existing errors across many unrelated files (chiefly test files using `@ts-nocheck`/`any`/`require()` per a long-standing, repo-wide test-file convention); fixing those is explicitly out of scope ("unrelated refactoring") and was not attempted. |

The backend unit and PostgreSQL integration counts match the authoritative baseline established earlier in this task's work exactly (173/1803 and 88/1678 respectively), now independently re-confirmed from a cold environment.

## 22. Remaining risks

1. **RuntimeAccessGuard structural gap (§7):** the guard does not itself enforce `route.policy.allowedPrincipalTypes` for any `WORKFORCE_SESSION` principal type. Today this is covered end-to-end because every controller behind such a route independently re-checks `principal.type`. This is a latent risk: a **future** controller added behind a `WORKFORCE_SESSION` route that forgets its own principal-type check would have no fallback protection from the guard. Not fixed in this task because no live gap exists to justify an undemonstrated, broad change to the mature A2 authorization path (a prototype fix broke 5 unrelated pre-existing contracts — see §7).
2. **No lockout on SUPPORT login (§5):** left unfixed because the underlying secret (96-bit random temporary password) is not realistically brute-forceable; still an inconsistency with the Customer/Agent lockout convention.
3. **`isCheckViolation` asymmetry in limit-catalog services (§15):** confirmed not reachable today because pre-DB validation already covers every constrained field at least as strictly; would become a live risk only if a future change added a new DB `CHECK` constraint without an equivalent pre-insert validation.
4. This audit covers only the SUPPORT authentication surface and the two named adjacent items. It does not re-certify the A2 Finance/OIDC workforce stack, Agent, or Customer authentication beyond the cross-boundary checks in §12.

## 23. Recommended next task

A dedicated, narrowly-scoped follow-up task to add genuine guard-level `route.policy.allowedPrincipalTypes` enforcement in `RuntimeAccessGuard` for all `WORKFORCE_SESSION` principal types, run against the **full** unit + integration + mobile regression suite, with any status-code/message changes in currently-passing tests treated as intentional contract updates requiring explicit sign-off (not silently absorbed) — closing the defense-in-depth gap identified in §7/§22 without an unproven, broad change bundled into an unrelated audit task. A secondary, much smaller candidate is adding a `MAX_FAILED_AUTHENTICATIONS`-style lockout to `SupportAuthenticationService.login()` purely for convention-consistency with Customer/Agent (§5), and/or an `isCheckViolation` catch in the limit-catalog services purely for defense-in-depth consistency with `isUniqueViolation` (§15) — both are optional hardening, not required by any demonstrated exploit.

---

## Final status

**B. SUPPORT AUTHENTICATION HARDENING VERIFIED — P0/P1/P2 FIXES IMPLEMENTED**
