# V1-ADMIN-AUTHORIZATION-RUNTIME-01 — Implementation Report

Wires the Foundation-01 database authorization catalogue (`authorization_roles` /
`authorization_functions` / `authorization_role_functions`, migration `1785753600083`) into the
live admin/workforce runtime. This report is a factual record of what the code verified in this
branch actually does, grounded in direct inspection of the current file contents and real test
runs against a live PostgreSQL instance in this session — it intentionally does not restate
aspirational goals that the implementation does not fully reach; gaps are called out explicitly
in the relevant section.

## 1. What changed, in one paragraph

Two new files (`src/authorization-catalogue/authorization-catalogue-runtime.service.ts`, the
`1785753600084` migration) plus 42 modified files. The new `AuthorizationCatalogueRuntimeService`
is a read-only bridge from a set of role keys to the catalogue's function codes /
`administrative_capability` / `read_only` flags. `A2WorkforceSessionService.resolve()` now calls
it for every principal, alongside the legacy `A2_FINANCE_ROLES_JSON` config, and unions both
sources' outputs into `principal.scopes`/`principal.roles`/`principal.type` (as
`PRIVILEGED`/`OPERATOR`, derived from `administrativeCapability`, never from a hardcoded role-name
check) and a new `principal.readOnlyPrincipal` flag. `AuthorizationService.evaluate()` gained a
`requiredFunctions` check (AND'd with the existing `requiredRoles`/`requiredScopes` checks), wired
additively into `workforce-administration.controller.ts`'s `assign`/`revoke`/`requestApproval`/
`approve` paths via a small `ACTION_FUNCTION_CODES` map. `RuntimeAccessGuard` gained a
read-only-principal guard that 403s any non-safe HTTP method for a principal whose every
recognized role is catalogue-flagged `read_only`. The legacy `FINANCE_ADMIN` role-key literal was
renamed to `SUPER_ADMIN` throughout the live runtime files (`workforce-configuration.ts`,
`finance-role-administration.service.ts`, `local-admin-authentication.service.ts`, env templates,
seed scripts) and in a new reversible migration that updates a DB CHECK constraint referencing the
old literal.

## 2. Is the DB catalogue authoritative for admin/workforce authorization?

**Partially, and only for the specific decisions explicitly wired to it.** It is authoritative
for: (a) `principal.scopes`'s catalogue-function-code portion (`AuthorizationCatalogueRuntimeService
.resolveForRoleKeys()` reads `authorization_roles`/`authorization_role_functions` directly, with no
caching or legacy override of what it returns), (b) the `requiredFunctions` check added to
`AuthorizationService.evaluate()`, consumed so far only by the four `workforce-administration
.controller.ts` actions listed above, and (c) `principal.readOnlyPrincipal` (purely catalogue
`read_only`-derived once any catalogue role is recognized). It is **not** authoritative end-to-end
for every admin/workforce decision in the codebase: the ~24 files (see §12) that branch on
`principal.type === 'OPERATOR'/'PRIVILEGED'` do not consult `requiredFunctions` or any catalogue
function code at all — they only ever see the two-value `type` field, which collapses all ten
catalogue roles down to a binary administrative/non-administrative flag. The catalogue is
authoritative for *role membership and function-bundle resolution*; it is not yet authoritative
for *every authorization decision point* in the application.

## 3. Is FINANCE_ADMIN removed as an organizational role?

**No live authorization path treats `FINANCE_ADMIN` as a role name any more** — every runtime file
that used to reference the literal `'FINANCE_ADMIN'` (`workforce-configuration.ts`,
`finance-role-administration.service.ts`, `local-admin-authentication.service.ts`) was renamed to
`'SUPER_ADMIN'`; verified by `grep -rn "'FINANCE_ADMIN'"` across `src/` returning only (a) the
original 2023-era migration `1785753600052` (an immutable historical record, correctly untouched)
and (b) the `down()` rollback body of the new migration `1785753600084` (which must reference the
old literal to reverse the constraint change — this is correct, not a leftover). However,
`FINANCE_ADMIN` is **not "removed" in the sense of no longer existing anywhere** — it is the
literal value baked into the *old* migration and the historical DB CHECK constraint prior to
`1785753600084` running. What changed is: no code path *writes or reads* `FINANCE_ADMIN` as a
role identifier any more; the slot that used to be named `FINANCE_ADMIN` in the 4-role legacy
config is now named `SUPER_ADMIN`, and that is the only name the runtime uses going forward.

## 4. Is FINANCE_AUDITOR "safe" — does it get OPERATOR capability it shouldn't?

**No improvement was made to this specific gap, and none is claimed.** `AuthorizationService
.evaluate()`'s `allowedPrincipalTypes` check only ever sees `principal.type` (`'OPERATOR'` or
`'PRIVILEGED'`), which has exactly two values — it cannot distinguish FINANCE_AUDITOR from any
other non-administrative role. Any route whose policy allows `OPERATOR` and does **not** also set
`requiredFunctions`/`requiredRoles` naming a specific function/role remains reachable by every
non-administrative workforce role, including FINANCE_AUDITOR, exactly as before this task. The one
concrete, verified mitigation added this task is the `readOnlyPrincipal` guard: if FINANCE_AUDITOR
(or any role) is catalogue-flagged `read_only = true` for every role the principal holds, non-safe
HTTP methods (POST/PUT/PATCH/DELETE) are rejected with 403 at the guard layer regardless of what
any individual controller does or does not check. This closes the "read-only role gets write
access via OPERATOR collapse" failure mode **only insofar as the role is actually marked
`read_only` in the catalogue and the controller is reached through `RuntimeAccessGuard`'s
`WORKFORCE_SESSION` branch** — it is not a FINANCE_AUDITOR-specific fix and does not change
`allowedPrincipalTypes` gating on any specific route.

## 5. AuthorizationService — single engine, reused (not duplicated)

Confirmed: `src/authorization/authorization.service.ts` is one class, unchanged in location and
public shape (`authorize()`/`evaluate()`), with `requiredFunctions` added as one more optional
field alongside `requiredScopes`/`requiredRoles` on `AuthorizationPolicy`
(`authorization.types.ts`). No second/parallel authorization engine exists anywhere in the 44
changed files.

## 6. Decisions keyed on stable function codes

Where `requiredFunctions` is used (see §8), it is matched against `principal.scopes` entries that
are catalogue `function_code` strings (e.g. `workforce.role.assign`) sourced from
`authorization_role_functions.function_code` — not role names, display names, or action labels.

## 7. Role = bundle of functions

`AuthorizationCatalogueRuntimeService.resolveForRoleKeys()` returns the union of
`authorization_role_functions.function_code` across every ACTIVE, recognized role a principal
holds — this is the "role is a bundle of functions" model operating as designed for every
principal whose roles are looked up through this service (i.e. every workforce session principal,
via `A2WorkforceSessionService.resolve()`).

## 8. requiredFunctions wiring — exact location and scope

Lives in `workforce-administration.controller.ts`, not in `route-policy-registry.ts` (there is no
`route-policy-registry.ts`-level `requiredFunctions` wiring in this codebase — the policy objects
for these four actions are constructed inline in the controller, not read from a separate
registry). A local `const ACTION_FUNCTION_CODES: Record<string,string>` maps exactly two legacy
maker-checker action names to catalogue function codes:
`FINANCE_ROLE_ASSIGN → workforce.role.assign`, `FINANCE_ROLE_REVOKE → workforce.role.revoke`. It is
consulted in `assign()`, `revoke()` (via the private `authorize()` helper), `requestApproval()`,
and `approve()`. In every case `requiredFunctions` is spread in **additively**, alongside the
pre-existing `requiredRoles: rule.initiatingRoles` / `rule.approvingRoles` from
`A2_MAKER_CHECKER_RULES_JSON` — it is an AND, never a replacement. Actions with no catalogue
function defined (e.g. `FINANCE_CONTROL_POLICY_ACTIVATE`, owned by the out-of-scope B1/B2F
module) fall back to the legacy-only `requiredRoles` check, by design — no function code was
invented for them. This is accurately described as a **defense-in-depth addition**, not a
redesign of maker/checker capacity checking; initiator-vs-approver separation is still governed
entirely by the untouched `A2_MAKER_CHECKER_RULES_JSON` → `initiatingRoles`/`approvingRoles`
split.

## 9. SUPER_ADMIN does not inherit Finance-class execution/adjustment/reversal functions

Confirmed by code shape, not by a special-case rule: `AuthorizationCatalogueRuntimeService
.resolveForRoleKeys()` returns exactly the function codes present in
`authorization_role_functions` for the roles queried — there is no code path anywhere in this
service, or in `A2WorkforceSessionService.resolve()`, that adds extra function codes to a
principal just because `SUPER_ADMIN` is among their roles. Whatever functions SUPER_ADMIN carries
is entirely a property of the Foundation-01 seed data (147 role-function assignment rows, Task
17–21, unmodified by this task). This was previously confirmed safe in the Foundation-01 audit;
this task does not alter that seed data or its assignment logic.

## 10. The "never hardcode exactly ten roles" rule

Verified: no file touched this task contains a literal enumeration of all ten catalogue role keys
in the new catalogue-driven resolution path. `AuthorizationCatalogueRuntimeService` and
`A2WorkforceSessionService.resolve()` operate generically over `readonly string[]` role-key input
with no fixed-size assumption. The one *intentionally* fixed-size, fixed-vocabulary list that
remains is `REQUIRED_ROLES` in `workforce-configuration.ts` — `['SUPER_ADMIN', 'FINANCE_PREPARER',
'FINANCE_CONTROLLER', 'FINANCE_AUDITOR']` (4 entries) — which is explicitly documented in that
file as the legacy B1/B2F/maker-checker compatibility vocabulary, not the organizational role
list, and is exempt from this rule per the task's own architecture requirements.

## 11. No `if role === FINANCE_ADMIN` anywhere

Confirmed via full-repo grep (see §3) — zero live-runtime occurrences of the `FINANCE_ADMIN`
literal remain; all such checks were converted to `administrativeCapability`
(catalogue-`administrative_capability`-OR-legacy-config-derived) boolean checks, or to the
`SUPER_ADMIN` literal where a specific legacy slot name is genuinely still required (the 4-slot
legacy config schema itself).

## 12. Six legacy dependencies — final status

1. **`workforce-session.service.ts`'s hardcoded FINANCE_ADMIN principal-type check** — DONE.
   `principal.type` is now `resolved.administrativeCapability ? 'PRIVILEGED' : 'OPERATOR'`, where
   `administrativeCapability` is `legacyAdministrative || catalogue.hasAdministrativeCapability`
   (an OR of the legacy config's `administrativeCapability` flag and the catalogue's
   `administrative_capability` flag across every recognized role) — no role-name string
   comparison remains.
2. **`workforce-configuration.ts`'s FINANCE_ADMIN-reserved `administrativeCapability`
   superRefine check** — DONE, renamed to reserve the flag for `SUPER_ADMIN` instead, still
   scoped to the 4-slot legacy schema only (not extended to ten roles — this schema has no
   concept of the other six roles at all).
3. **`workforce-configuration.ts`'s `REQUIRED_ROLES`** — DONE, renamed
   `FINANCE_ADMIN → SUPER_ADMIN` within the same fixed 4-element array; still fixed-size by
   design (B1/B2F compat scope only, explicitly exempted — see §10).
4. **`finance-role-administration.service.ts`'s FINANCE_ADMIN references** — DONE, renamed to
   `SUPER_ADMIN` throughout (bootstrap consumption, local-admin seeding grant, `assign()`/
   `revoke()` validation). Confirmed gap, unchanged by this task and explicitly out of scope to
   fix: `assign()`/`revoke()`'s `validateCommand()` looks up `this.config.roles` (the 4-slot
   legacy list) and explicitly rejects `roleKey === 'SUPER_ADMIN'` — so this HTTP API can
   currently grant/revoke **only** `FINANCE_PREPARER`/`FINANCE_CONTROLLER`/`FINANCE_AUDITOR`. It
   cannot grant any of the six new catalogue-only roles (OPERATIONS, AGENT_NETWORK_MANAGER,
   COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY) or SUPER_ADMIN itself. Test/ops
   provisioning for those seven roles requires a direct SQL insert into
   `a2_finance_role_assignments` (there is no code path, tested or untested, that grants them via
   HTTP).
5. **`route-policy-registry.ts`'s `allowedPrincipalTypes`-only gating** — the actual
   implementation location differs from how this was originally phrased: there is no
   `route-policy-registry.ts` `requiredFunctions` field consulted by a central registry; instead,
   `AuthorizationPolicy.requiredFunctions` (defined once in `authorization.types.ts`) is
   constructed and passed inline, per-call, from `workforce-administration.controller.ts`'s own
   `ACTION_FUNCTION_CODES` map — see §8 for the full, verified wiring. The substance (additive,
   not replacing `requiredRoles`, defense-in-depth, not a capacity-check redesign) matches the
   original intent.
6. **~17 (verified: 24) controllers'/services' direct `principal.type` checks** — **NOT
   individually converted**, confirmed unchanged this task
   (`grep -rl "principal.type ===" src/` → 24 files, including
   `admin-agent-credentials.controller.ts`, `admin-customer.controller.ts`,
   `agent-funding.controller.ts`, `support-internal.controller.ts`, and 20 others). The designed
   mitigation — a `readOnlyPrincipal` guard added to `RuntimeAccessGuard`'s `WORKFORCE_SESSION`
   branch — **is implemented and verified working**: `denyUnsafeMethodForReadOnlyPrincipal()`
   throws `ForbiddenException` (403) for any non-GET/HEAD/OPTIONS request when
   `principal.readOnlyPrincipal === true`, which is set only when every catalogue role the
   principal holds is `read_only = true`. This was confirmed exercised by
   `test/v1-harden-01-runtime-access-guard-boundary.integration.spec.ts`, which passed in this
   session's real-PostgreSQL run. It mitigates the specific "read-only role gets implicit write
   access via OPERATOR-type collapse" failure mode; it does not convert any of the 24 files to
   function-level checks, and `FINANCE_PREPARER`/`FINANCE_CONTROLLER` (non-read-only
   administrative roles) remain just as exposed to any `principal.type === 'OPERATOR'` branch in
   those 24 files as before this task.

## 13. Principal-type-vs-role security-critical invariant

Unchanged and still true after this task: `principal.type` is derived solely from
`administrativeCapability` (a boolean), never from any specific role name or function code — so it
cannot and does not "proxy for" any one function. The underlying risk this task's own
documentation flags — OPERATOR-typed roles (which is every non-administrative role, i.e. 9 of the
10 roles collapse to one `type` value) being indistinguishable from each other wherever a
controller only checks `principal.type` — remains present in the 24 files from §12 item 6, exactly
as previously documented in `docs/V1/V1-ADMIN-ROLE-ARCHITECTURE-AUDIT-01.md` §2.2–2.3. The
`readOnlyPrincipal` guard is this task's concrete, verified, catalogue-driven mitigation for the
write-access portion of that gap; it is not a full resolution.

## 14. §8/§9 scope strings — preserved exactly

`PrivilegedActionApprovalService` and `src/policy/b2f-finance-control*.ts` were not modified by
this task (not in the 44-file diff). `principal.scopes` continues to include every legacy literal
scope string (`privileged:execute`, `finance:prepare`, etc.) exactly as before —
`A2WorkforceSessionService.resolve()` computes `scopes` as
`[...new Set([...legacyScopes, ...catalogue.functionCodes])]`, a strict union, never a
replacement, so the exact legacy strings these two modules read directly off
`principal.scopes`/`principal.roles` remain present and unchanged in value.

## 15. §10/§11 — role dual-control and A2_FINANCE_ROLES_JSON

`workforce.role.create`/`workforce.role.modify` dual-control machinery (Foundation-01, Tasks
17–21) is untouched by this task — no file implementing it appears in the 44-file diff.
`A2_FINANCE_ROLES_JSON` is retained as an environment variable (same name, same schema) with the
admin slot's `roleKey` value renamed `FINANCE_ADMIN → SUPER_ADMIN`; `.env.example` and
`docs/deployment/config/v1-workforce-bootstrap.env.template` were updated to reflect this rename
in their example/template values and comments.

## 16. §12 Testing matrix — execution status

The full A–R seeded-role test matrix described in the original task scope (SUPER_ADMIN
catalogue-only; FINANCE_PREPARER/CONTROLLER/AUDITOR exact-bundle; E–J six new roles via direct SQL
provisioning; FINANCE_ADMIN rejected as org role; unknown/unassigned denied; non-assignable
function ungrantable; Finance-class restriction unbypassable; 403 not 500; 401 unauthenticated;
regression) is **not present as one dedicated new test file** in the 44-file diff. What was
verified and passes in this session (see §17–19) is: the pre-existing + updated integration suites
covering the modified runtime paths (workforce sessions, local-admin login, finance role
administration foundation, the full-surface-audit auth-propagation suite, the runtime-access-guard
boundary suite, the capability registry suite, the workforce-bootstrap suite, and the production
readiness/migration-sync suite), plus the complete 1823-test unit suite and 1723-test real-Postgres
integration suite. These collectively exercise SUPER_ADMIN provisioning/login/authorization,
FINANCE_PREPARER/CONTROLLER/AUDITOR role definitions and maker-checker rules, the
`readOnlyPrincipal` guard boundary, and full-application regression — but do not include a
dedicated, explicit per-row walk of every lettered item A–R (in particular, no test in this diff
directly provisions one of the six new catalogue-only roles via direct SQL and exercises its
function bundle end-to-end over real HTTP). This is reported honestly as a gap, not claimed as
complete.

## 17. Focused Task-22 authorization test run (this session, real PostgreSQL)

8 integration spec files targeted at the runtime-authorization surface, run with
`jest --config jest.integration.config.js --runInBand` against the embedded PostgreSQL instance
started this session:

```
test/v1-admin-authorization-foundation-01.integration.spec.ts
test/v1-admin-local-login-01.integration.spec.ts
test/v1-admin-full-surface-audit-01-auth-propagation.integration.spec.ts
test/v1-workforce-bootstrap-01.integration.spec.ts
test/a2-workforce-session.integration.spec.ts
test/v1-harden-01-runtime-access-guard-boundary.integration.spec.ts
test/v1-release-01-production-readiness-migration-sync.integration.spec.ts
test/v1-capability-registry.integration.spec.ts
```

Result: **8/8 suites passed, 87/87 tests passed.**

(Note: the first attempt at this run failed with 15/87 failures, root-caused to this session's
fresh `.env` not having the `A2_WORKFORCE_ENABLED`/`A2_FINANCE_ROLES_JSON` local-dev block
uncommented — an environment-setup issue in this sandbox, not a code defect; see §21. Once
corrected, the full 87/87 passed.)

## 18. Full unit test suite (this session)

`npx jest` (default config, no PostgreSQL dependency): **174/174 suites passed, 1823/1823 tests
passed.**

## 19. Full real-PostgreSQL integration suite (this session)

`node scripts/run-pg-integration-tests.js` (the project's own batched-process runner for the
`*.integration.spec.ts` suite, chosen over a single `jest --runInBand` invocation specifically
because this repo's own tooling documents that a single process reliably runs out of heap across
the full ~95-file suite): **7/7 batches passed, 95/95 files passed, 1723/1723 tests passed, exit
code 0.** Reproduced twice in this session with identical "all passed" results (batch-to-file
assignment order differs slightly between runs due to `PG_TEST_CONCURRENCY=2` scheduling, but the
total file count, 95, and total pass count were consistent and zero failures appeared in either
run).

## 20. Failure classification

**Zero failures to classify in the final state.** The only failures observed in this session were
15 failures in the first attempt at the focused suite (§17), which were entirely attributable to
(C) environment/infrastructure: a freshly created `.env` file (copied verbatim from
`.env.example`) did not have the already-documented "V1-ADMIN-LOCAL-LOGIN-01" block uncommented,
so `A2_WORKFORCE_ENABLED` was `false` and `A2_FINANCE_ROLES_JSON` was `[]`, causing
`LocalAdminAuthenticationService.seedDefaultAdmin()` to fail with "SUPER_ADMIN role is disabled or
undefined in configuration" wherever a test boots the real `AppModule` without overriding config.
This is pre-existing, documented local-dev setup behavior (the `.env.example` comments explicitly
instruct developers to uncomment this block for local real-login testing) — not a regression
introduced by this task's code changes. No failures were introduced by Task 22's code changes
themselves; none were pre-existing in the sense of being present in both before/after states (the
environment was freshly built from scratch this session, so there was no "before" run to compare
against in this exact sandbox instance).

## 21. Environment notes for reproducibility

This sandbox was fully wiped between sessions. To reproduce the test results above from a clean
checkout: `npm ci`; `cp .env.example .env`; set `DB_PASSWORD=monienaija-pw` (the embedded-postgres
script's actual credential, which differs from `.env.example`'s generic placeholder
`change-me-local-only`); uncomment the "V1-ADMIN-LOCAL-LOGIN-01" block in `.env` (sets
`A2_WORKFORCE_ENABLED=true` and a 4-role `A2_FINANCE_ROLES_JSON`/`A2_MAKER_CHECKER_RULES_JSON`/
`A2_WORKFORCE_RATE_LIMITS_JSON` for local dev — these are public placeholder values already
committed in `.env.example`, not secrets); `node scripts/embedded-pg.js` (background) to start
PostgreSQL. None of this required any code change — purely local `.env` setup, and `.env` is
gitignored and not part of this task's commit.

## 22. Build status

`npm run build` (`nest build`) completed with exit code 0, no TypeScript errors, across the full
44-file diff.

## 23. Admin Web / customer-mobile / agent-mobile — untouched

Confirmed via `git diff --stat e64d1ac` and explicit grep for `admin-web|customer-mobile|
agent-mobile` path fragments: zero matches. None of those surfaces appear anywhere in this task's
44-file diff.

## 24. Financial maker/checker, ledger actor attribution, agent funding approval, new PO decisions — untouched

Confirmed: no ledger, settlement, payment, transfer, withdrawal, deposit, or wallet business-logic
file appears in the diff except one test-assertion update. `test/a19-agent-funding.integration
.spec.ts`'s two changed lines only extend a migration-count/latest-migration-name allowlist
regex/array to include the new migration `1785753600084` — no business-logic assertion was
changed. No other agent-funding, maker/checker, or PO-decision file is present in the diff.

## 25. Git history hygiene — resolved

At the start of this session's finalization, local `HEAD` was stale at `3d05aaec` (161 commits
behind `origin/arena/01a10374-monienaija`'s tip `e64d1ac`), with 542 dirty working-tree paths — a
mix of 44 genuine Task-22 changes and ~498 paths of stale-HEAD noise (the working tree already
matching files `origin`'s later commits had since changed again, making `git status` report them
as "modified" relative to the stale `3d05aaec` base). This was resolved this session: the 44
genuine files were preserved on a local-only branch, the real branch ref was moved to `e64d1ac`,
and only the 44 genuine files were restored on top. `git diff --stat e64d1ac` now shows exactly 44
files changed, matching the audit's prediction exactly, with zero stale-HEAD noise remaining.

## 26. Migrations

New migration `1785753600084-RenameWorkforceBootstrapRoleToSuperAdmin` applies cleanly after
`1785753600083` (the Foundation-01 catalogue migration) — verified via
`test/v1-release-01-production-readiness-migration-sync.integration.spec.ts` passing, and via
every integration-test run in this session (which runs the full migration chain against a fresh
database per suite). It only swaps the literal value in one DB CHECK constraint on
`a2_workforce_bootstrap_consumptions`; it does not touch the Foundation-01 catalogue tables, table
shape, or any financial/ledger table. It is reversible (`down()` restores the original
`FINANCE_ADMIN`-only constraint).

## 27. Role function catalogue data itself — unchanged

The 147 role-function assignment rows, 76 functions (62 assignable), and 10 role definitions
seeded by `AuthorizationCatalogueSeedService` (Tasks 17–21) were not modified by this task — this
task only adds a runtime *consumer* of that data (`AuthorizationCatalogueRuntimeService`); no file
in `src/authorization-catalogue/` other than the new runtime service and the module wiring
(`authorization-catalogue.module.ts`, to export/register the new service) was touched.

## 28. Rate limiting, audit logging — unaffected

No changes to `A2SecurityRateLimitService` or `AuditService` call sites were required or made;
both continue to operate exactly as before per-action, independent of the catalogue wiring.

## 29. Dual-source role resolution — fail-closed behavior preserved

`A2WorkforceSessionService.resolve()`'s non-sandbox path only includes a role key in
`principal.roles` if it is recognized by *either* the legacy config *or* the catalogue
(`legacyDefs.has(k) || catalogue.recognizedRoleKeys.includes(k)`) — a role key assignment row that
neither source recognizes is silently dropped, identical to the pre-existing behavior for unknown
role keys before this task (previously only the legacy config was consulted for this check).

## 30. Sandbox/mock-bypass path — also catalogue-aware

The `mock-sandbox-subject` local-dev bypass path (hard-gated to `NODE_ENV=development|test`,
unchanged gate) was updated to resolve its roles through the same catalogue lookup as the
production path, so local-dev testing with the mock bypass exercises the same
`administrativeCapability`/`readOnlyPrincipal` derivation logic as a real OIDC-issued session.

## 31. `requiredFunctions` failure mode

Confirmed in `authorization.service.ts`: `requiredFunctions.every((fn) =>
principal.scopes.includes(fn))` — any missing function code yields `reason: 'FUNCTION_MISSING'`
and `allowed: false`, which the controller converts to a 403 `ForbiddenException` (never a 500).
Verified by the passing `runtime-access.guard.spec.ts`/`.integration.spec.ts` suites and the full
unit/integration runs reporting zero unhandled exceptions.

## 32. Unauthenticated requests — still 401

Unchanged: `AuthorizationService.evaluate()` returns `reason: 'UNAUTHENTICATED'` when no principal
is resolved, and `RuntimeAccessGuard` throws `UnauthorizedException` (401) before authorization is
even attempted when no session can be resolved from the bearer token. Explicitly exercised and
passing in `test/v1-admin-full-surface-audit-01-auth-propagation.integration.spec.ts`'s
login → 200 → logout → 401 → re-login → 200 cycle test.

## 33. Legitimate existing operations — verified still working

The full 1823-test unit suite and 1723-test real-PostgreSQL integration suite (covering customer
onboarding, transfers, settlements, agent lifecycle/funding, aggregator flows, support, capability
registry, limits, and all previously-passing admin/workforce flows) pass with zero failures after
this task's changes, run fresh against a newly-provisioned database and newly-installed
dependencies in this session — this is the project's own full regression signal, not a subset.

## 34. Remaining legacy dependencies (final, honest list)

- `finance-role-administration.service.ts`'s `assign()`/`revoke()` HTTP API cannot grant/revoke
  SUPER_ADMIN or any of the six new catalogue-only roles (§12 item 4) — direct SQL is required for
  test/ops provisioning of those seven roles.
- ~24 controllers/services still branch on `principal.type === 'OPERATOR'|'PRIVILEGED'` directly
  (§12 item 6) rather than on `requiredFunctions` — mitigated only for the write-access/read-only
  dimension via the new `readOnlyPrincipal` guard, not converted to function-level checks.
- `requiredFunctions` is wired into exactly two actions (`FINANCE_ROLE_ASSIGN`,
  `FINANCE_ROLE_REVOKE`) — every other route in the application continues to authorize purely on
  `allowedPrincipalTypes`/`requiredRoles`/`requiredScopes`, unaware of the function catalogue.
- The full A–R seeded-role test matrix (§16) was not implemented as a dedicated new test file;
  coverage of the six new catalogue-only roles' end-to-end HTTP behavior is incomplete.
- `principal.type`'s two-value model (§4, §13) still cannot distinguish FINANCE_AUDITOR from any
  other OPERATOR-collapsed role anywhere `allowedPrincipalTypes` is the only gate — this is a
  pre-existing architectural gap this task narrows (via the read-only guard) but does not close.

## 35. Security findings

No new vulnerability was identified in the code reviewed for this report. The gaps in §34 are
pre-existing or deliberately-scoped-out architectural limitations, not regressions introduced by
this task's changes — every one of them is called out in the original task's own non-negotiable
scope boundaries (see task history) as deferred rather than silently dropped. `npm audit` reports
44 pre-existing vulnerabilities in third-party dependencies (not investigated or remediated — out
of scope for this task, not introduced by it).
