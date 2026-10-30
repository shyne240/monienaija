# Independent re-acceptance of Report 32 remediation

**Review date:** 2026-10-30  
**Target branch:** `integration/main-backend-frontend-20261030`  
**Pinned target:** `0c828eada712c76b1a0ff9760e145248f386e788`  
**Remediation report:** `docs/audit/20261030/sprint1-security-acceptance/33-REPORT-32-REMEDIATION-20261030.md`  
**Security-remediation verdict:** **FAIL — H-01 is not fully closed**  
**Overall integration acceptance:** **Not assessed / still separate**

This is a documentation-only independent review. The pinned target was fetched and checked out in a detached worktree. No application source, test, migration, production data, provider, or deployment was modified. The Report 30 architecture was not implemented.

## Executive result

The GET-route remediation is substantive and mostly well targeted: operational GETs now declare catalogue function requirements, `/internal/version` is no longer public, the prior 17 failing assertions were replaced with explicit contract/security tests, generic customer financial commands remain denied, and the approved SUPPORT audit-read behavior is retained.

However, the route gates are exact `GET`-method entries. The app uses `FastifyAdapter`, which automatically serves a matching GET route for `HEAD` requests by default. `HEAD /api/v1/internal/readiness` therefore reaches the generic `/internal/*` policy rather than the function-gated policy. The generic policy admits SUPPORT and has no `requiredFunctions`. I independently confirmed the registry resolution for `HEAD` returns `resourceType: internal-route`, includes SUPPORT, and has no function requirement; a Fastify injection of `HEAD` against a GET route returned 200 and executed the handler. For `version`, `configuration`, `deployment` and `readiness`, `ProductionController` has no second capability check, so SUPPORT reaches these handlers through HEAD; in particular, readiness runs the reconciliation scan and its telemetry write. The `metrics`, `diagnostics` and `outbox` handlers do have controller-level `requireFunction()` checks, which continue to deny SUPPORT even when the route policy falls through. The policy bypass still leaves these routes inconsistent and untested, but the direct access finding is on the four production routes. This violates the requirement that SUPPORT not reach restricted operational endpoints and that the production routes receive least-privilege authorization for every exposed HTTP method.

A second least-privilege gap remains on `GET /internal/audit`: the explicit policy has no function gate and permits every workforce principal type, not just SUPPORT and principals with `audit.view`. The catalogue assigns `audit.view` to SUPER_ADMIN and FINANCE_AUDITOR, but an OPERATIONS principal with no `audit.view` is still admitted by the policy. The approved SUPPORT exception can be preserved without granting this unqualified access to all other roles.

The remediation report also overstates reconciliation as strictly read-only. Its ledger/data checks execute in `REPEATABLE READ` with `SET TRANSACTION READ ONLY`, but after that transaction `runReconciliation()` calls `MetricsService.observeDuration()`, which performs an `INSERT ... ON CONFLICT DO UPDATE` to `operational_metrics`. No ledger or customer financial state is written, and the remediation did not change this code; still, the operation is not literally side-effect-free. The proposed decoupling was **not implemented**, as required.

Because of the `HEAD` path, the security remediation does **not** pass. Focused unit/HTTP tests and TypeScript compilation pass, but they test only GET requests and do not cover either residual authorization gap. PostgreSQL tests could not be run in this environment because the embedded PostgreSQL binary fails to load `libpq.so.5`.

## Re-acceptance checks

| Requirement | Result | Independent finding |
|---|---|---|
| H-01: all internal operational routes use least-privilege catalogue authorization | **FAIL** | GET policies are improved, but `HEAD` falls into the un-gated generic route; audit is also un-gated for non-SUPPORT workforce roles. |
| M-01: internal version denies anonymous and customer access | **PASS for GET; incomplete method coverage** | Removed from `PUBLIC_ROUTES`; GET goes through `diagnostics.view`. Existing matrix tests pass for anonymous and customer GET. `HEAD` still reaches the un-gated fallback for an authenticated SUPPORT caller. |
| SUPPORT can read approved audit but cannot access other restricted operations | **FAIL** | GET denial tests for SUPPORT pass on the seven gated routes; SUPPORT can invoke those same handlers via HEAD. Audit-read retention works, but its allow-list grants non-SUPPORT workforce principals without `audit.view` access too. |
| 17 previous failures replaced without weakening security | **CONDITIONAL PASS** | New expectations retain denial and assert service non-invocation for generic customer routes; exact function and principal tests are added. Coverage is GET-only and the PG/end-to-end replacement suites were not independently run. |
| Generic financial commands disabled; `/customers/me/*` ownership remains | **PASS by source and test inspection; PG not rerun** | Controllers still deny generic customer commands; customer transfer handler derives `CUSTOMER_SELF` from the authenticated principal; service checks ownership for new and idempotent replay paths. Existing a23 tests exercise foreign source-wallet denial. |
| OTP registration remains protected | **PASS by source and test inspection; PG not rerun** | Only the three dedicated OTP registration routes are public; bare `POST /customers` is not. Registration completion requires a verification token, and the existing onboarding integration suites cover OTP request/verify/complete, expiry and abuse controls. |
| No security regressions from remediation | **FAIL** | HEAD-method policy fall-through and the broad audit allow-list remain. No financial/controller/migration/provider changes were found in the remediation diff. |
| Readiness reconciliation read-only; decoupling proposal not implemented | **PARTIAL** | Scan SQL is in a read-only transaction and has no ledger/customer-financial writes. Duration metrics are written afterward. Proposed readiness/deployment decoupling is absent from the diff. |

## Findings

### H-01-R1 — HEAD requests bypass the new internal operational function gates

**Severity: High**  
**Affected policy resolution:** `HEAD /api/v1/internal/{readiness,deployment,configuration,version,metrics,diagnostics,outbox}`. Direct access reaches the ungated handler for `readiness`, `deployment`, `configuration` and `version`; `metrics`, `diagnostics` and `outbox` remain protected by their existing controller-level function checks.

`INTERNAL_OPERATIONAL_ROUTE_POLICIES` contains only `GET ...` keys. `resolve()` uppercases the incoming method, but does not normalize `HEAD` to `GET` or look up a corresponding HEAD policy. The request therefore falls through to the generic `/api/v1/internal/` branch:

- `authenticationMode: WORKFORCE_SESSION`;
- `allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED']`;
- no `requiredFunctions` or `requiredScopes`.

The Nest app and real-HTTP matrix use `FastifyAdapter`. Fastify's default HEAD exposure maps HEAD to the GET handler. A direct registry check at the pinned commit confirmed the `HEAD /api/v1/internal/readiness` policy is the generic `internal-route` with SUPPORT allowed and no required functions. A Fastify probe confirmed HEAD returns 200 and invokes the GET handler (with an empty body). `ProductionController` has no controller-level capability check, so a valid SUPPORT caller can invoke readiness/deployment/configuration/version handlers through HEAD. The three OperationsController endpoints (metrics/diagnostics/outbox) retain their own `requireFunction()` calls and still deny SUPPORT; their registry fallback should nevertheless be normalized and covered consistently. Even though HEAD suppresses the body, it invokes the protected production code; readiness performs the reconciliation scan and the metrics write described below.

**Required fix — Authorization/Security owner:** apply the same route policy to HEAD as GET for each GET-backed internal route (or disable automatic HEAD exposure for these handlers and prove that it is disabled in the deployed adapter). Avoid a generic fallback. Add real-HTTP tests for anonymous, CUSTOMER, SUPPORT, OPERATIONS and function-bearing principals using HEAD on every operational path. Assert denied handlers/services are not invoked. Re-run the GET authorization suite as regression coverage.

### H-01-R2 — audit access is not least-privilege for catalogue-governed workforce roles

**Severity: High**  
**Affected route:** `GET /api/v1/internal/audit`

The explicit `INTERNAL_AUDIT_READ` policy lists `SUPPORT`, `OPERATOR`, `SERVICE`, and `PRIVILEGED`, but declares no `requiredFunctions`. The approval to retain SUPPORT audit-reading does not grant every other workforce principal audit-reading. The catalogue assigns `audit.view` to SUPER_ADMIN and FINANCE_AUDITOR, not OPERATIONS. `AuthorizationService` enforces a policy's functions only when declared; `OperationsController.getAudit()` falls back to the ordinary `auditService.list()` when its notification-provider-specific check is not allowed. Consequently, an OPERATIONS-shape principal with no `audit.view` is accepted by route policy and can read the ordinary audit list.

The current tests prove SUPPORT succeeds and SUPPORT is denied on the seven other GET routes. They do not prove that an OPERATIONS principal without `audit.view` is denied audit. The OPERATIONS fixture used in the tests carries no `audit.view`, making it an appropriate direct negative case.

**Required fix — Authorization/Security owner with Product approval preserved:** retain a narrowly scoped SUPPORT exception for audit, while requiring `audit.view` for catalogue-governed workforce principals (and retaining denial for CUSTOMER/AGENT/AGGREGATOR). Add HTTP tests: SUPPORT allowed on audit; FINANCE_AUDITOR allowed; OPERATIONS without `audit.view` denied; notification-provider audit rows still require `notification.provider.view`. Do not simply add a `requiredFunctions` gate that blocks the expressly approved SUPPORT principal unless the policy supports an explicit SUPPORT exception.

### R-01 — readiness reconciliation is ledger-read-only but not side-effect-free

**Severity: Low / clarification required**

`ReconciliationService.withReadOnlyTransaction()` uses `REPEATABLE READ` plus `SET TRANSACTION READ ONLY`, and the reconciliation queries inspected are SELECTs. But `runReconciliation()` exits that transaction and then calls `metricsService.observeDuration('reconciliation.duration_ms', startedAt)`. `MetricsService.observeDuration()` delegates to `increment(undefined, ...)`, which issues an `INSERT ... ON CONFLICT DO UPDATE` against `operational_metrics` using the standalone `DataSource`. So the financial-data scan is read-only, but the endpoint does mutate the operational metrics table on each run. The remediation report’s categorical statement that it "creates no ... mutates no state" is inaccurate.

`git diff` confirms the proposed readiness-decoupling change has **not** been implemented. This review does not request or implement that behavioral change. The owner should either (a) describe the operation accurately as financially read-only but telemetry-writing and approve that side effect, or (b) obtain approval for a change that removes/decouples the metric write. Do not claim strict read-only semantics without addressing it.

## Test and reproduction record

The pinned worktree was clean before dependency installation; no tracked file changed. `npm ci --ignore-scripts --no-audit --no-fund` installed 982 packages.

| Check | Independent result |
|---|---|
| `npx jest --runInBand test/runtime-access.guard.spec.ts test/authorization-http-matrix.spec.ts` | **PASS: 2 suites, 95 tests** (85 matrix + 10 registry/guard) |
| `npx tsc --noEmit -p tsconfig.json` | **PASS: 0 errors** |
| Report 33’s PostgreSQL integration suites | **Not run** — `node scripts/embedded-pg.js` exited during `initdb`: missing shared library `libpq.so.5`. No PostgreSQL service was available in the environment. |
| Registry edge check | `HEAD /api/v1/internal/readiness` resolves to generic internal route; SUPPORT is in the allowed principal types; no `requiredFunctions`. |
| Fastify HEAD check | Default Fastify HEAD route returned 200 and executed the GET handler; response body was empty, as expected for HEAD. |
| Readiness service trace | Read-only transaction verified; post-transaction telemetry write to `operational_metrics` identified. |

The unit matrix uses real `RoutePolicyRegistry`, real `RuntimeAccessGuard`, and real `AuthorizationService`, with persistence-backed dependencies replaced. It gives useful GET-level evidence, but it does not test HTTP method aliases. PostgreSQL results reported in Report 33 remain unverified here due to the missing runtime library.

## Security remediation vs overall integration acceptance

**Security remediation: FAIL.** M-01 is fixed for GET; GET-level H-01 controls are materially improved; the 17 cases are replaced with contract-aligned assertions. But the authorization policy can be bypassed for HEAD, and the audit route grants non-audit roles access beyond the approved SUPPORT exception. These are exact, actionable residual findings.

**Overall integration acceptance remains separate and is not granted by this report.** FundWallet/Withdraw remain unregistered and nonfunctional pending mobile-owner disposition; Admin Web and mobile owner ratifications remain outstanding; the Product Owner’s V1 contract ratification and full final test gates remain separate. No merge to main, deployment, production migration, provider activation, or Report 30 implementation is authorized.
