# V1-ADMIN-AUTHORIZATION-KYC-01 — KYC function authorization

## 1. Branch and scope

Branch: `arena/01a10374-monienaija` (session-fixed; all work committed and pushed here only).

Scope: close the gap flagged in V1-ADMIN-AUTHORIZATION-READ-SURFACE-01 §9 — `CustomerController`'s
`GET /customers/:id/kyc` and `POST /customers/:id/kyc-assessment` had **zero endpoint-specific
authorization**. Both were reachable by any principal type the generic `/api/v1/customers/*`
route-policy allows (`CUSTOMER` SELF, plus any `OPERATOR`/`SERVICE`/`PRIVILEGED` workforce
principal), with no catalogue function check — meaning any OPERATOR-collapsing workforce role
(FINANCE_PREPARER, FINANCE_CONTROLLER, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY, OPERATIONS,
AGENT_NETWORK_MANAGER) could view or decide KYC for any customer purely by virtue of its
principal type, even though the catalogue restricts `kyc.*` to SUPER_ADMIN, COMPLIANCE, and
(view-only) FINANCE_AUDITOR.

This task adds exactly the missing controller-level function checks. No new catalogue functions,
no business-logic change, no redesign, no mandatory second reviewer, no Admin Web change, no
financial maker/checker, no SUPPORT authorization, no customer-domain GET migration beyond the
KYC endpoints, no RoutePolicyRegistry redesign.

## 2. HEAD before / after

- HEAD before this task: `12dd74bafbeef369c7a8e12f98f7137a029249f5` (V1-ADMIN-AUTHORIZATION-READ-SURFACE-01, already merged/pushed, historical).
- HEAD after this task's commit: see §3.

## 3. Commit

Commit message (exact, as required): `feat(v1-admin-authz): enforce kyc function authorization`

## 4. Diff stats

```
 src/customer/customer.controller.ts | 65 +++++++++++++++++++++++++++++++++++--
 1 file changed, 62 insertions(+), 3 deletions(-)
```

Plus one new, untracked test file: `test/v1-admin-authorization-kyc-01.integration.spec.ts`
(new file, not a modification — does not show in `git diff --stat` for the pre-existing tree).

No other file was touched. `src/customer/customer.service.ts`, DTOs, entities, enums, migrations,
Admin Web, mobile apps, and all other controllers are untouched — verified via `git status
--porcelain` before commit (only the controller file shows as modified, plus the new test file as
untracked).

## 5. KYC endpoint inventory

| Method | Path | Pre-existing behavior | New behavior |
|---|---|---|---|
| `GET` | `/customers/:id/kyc` | No function check — any CUSTOMER(self)/OPERATOR/SERVICE/PRIVILEGED principal could read any customer's KYC state | Requires `kyc.view`, except CUSTOMER principals (see §6) |
| `POST` | `/customers/:id/kyc-assessment` | No function check — same over-broad reachability, for both review and decision actions | Requires `kyc.review`/`kyc.approve`/`kyc.reject`, derived from `dto.status`, except CUSTOMER principals |

No other endpoint on `CustomerController` carries any `kyc.*` semantics; `/profile`,
`/addresses`, `/contact-method`, `/identity-document`, and the lifecycle `PATCH :id` route are
unrelated to KYC and unchanged by this task (the lifecycle route already has its own
Decision-4 function gate from Hardening-01, untouched here).

## 6. Function mapping (approved, Decision 5)

```
GET  /customers/:id/kyc            -> kyc.view
POST /customers/:id/kyc-assessment -> status-derived:
       dto.status === NOT_STARTED  -> kyc.review
       dto.status === PENDING      -> kyc.review
       dto.status === APPROVED     -> kyc.approve
       dto.status === REJECTED     -> kyc.reject
```

The function is resolved from the actual `dto.status` value **before** the service performs the
transition (mirrors the Decision-4 `customer.suspend`/`.activate`/`.close` pattern already in this
controller for the lifecycle `PATCH` route). Approval and rejection are the two Decision-5 decision
outcomes and map 1:1 to their own distinct EXECUTE functions; recording a PENDING assessment or
resetting to NOT_STARTED is a non-decision review action and maps to the general `kyc.review`
function. At no point does holding one function imply or grant another — each request checks
exactly the one function its own `dto.status` resolves to.

**CUSTOMER principal exemption (unchanged business behavior):** a request whose
`authorizationPrincipal.type === 'CUSTOMER'` skips the function check entirely and falls through
to its pre-existing, unmodified path — gated only by the route-policy's `customerAccess: 'SELF'`
check, enforced by `RuntimeAccessGuard` before the controller runs (same pattern as this
controller's other customer sub-resource GETs: `/profile`, `/addresses`,
`/identity-documents`). Catalogue functions are a workforce-only authorization unit — a CUSTOMER
principal's `scopes` array is hardcoded to `[]` by `RuntimeAccessGuard`'s CUSTOMER-resolution
branch, so requiring a function would unconditionally deny every CUSTOMER request, which would be
an unauthorized, unreviewed business-behavior change this task is not scoped to make. No
customer-mobile code or existing test exercises these endpoints as CUSTOMER today (confirmed by
repository-wide grep), so this exemption changes nothing about current customer-mobile reachability
— it only closes the workforce OPERATOR-collapse gap the task targets.

AGENT/AGGREGATOR/SUPPORT principals never reach the controller for either route at all — already
excluded by the generic `/api/v1/customers/*` route policy's `allowedPrincipalTypes` at the
`RuntimeAccessGuard` level, independent of and unaffected by this change (confirmed by code trace
of `route-policy-registry.ts` and `runtime-access.guard.ts`, and by existing regression tests).

No catalogue function was invented. All four functions (`kyc.view`, `kyc.review`, `kyc.approve`,
`kyc.reject`) already existed in `src/authorization-catalogue/authorization-catalogue.seed.ts`
with exactly the role assignments Decision 5 specifies — this task only wires the controller to
check them; no catalogue migration or seed change was made or needed.

## 7. Role/function catalogue ground truth (confirmed via live seed, unmodified by this task)

| Function | V1 status | Assigned roles |
|---|---|---|
| `kyc.view` | IMPLEMENTED (VIEW) | SUPER_ADMIN, FINANCE_AUDITOR, COMPLIANCE |
| `kyc.review` | PARTIALLY_IMPLEMENTED (EXECUTE) | SUPER_ADMIN, COMPLIANCE |
| `kyc.approve` | PARTIALLY_IMPLEMENTED (EXECUTE) | SUPER_ADMIN, COMPLIANCE |
| `kyc.reject` | PARTIALLY_IMPLEMENTED (EXECUTE) | SUPER_ADMIN, COMPLIANCE |

No other V1 role (FINANCE_PREPARER, FINANCE_CONTROLLER, OPERATIONS, AGENT_NETWORK_MANAGER,
RISK_FRAUD, CUSTOMER_SERVICE, TREASURY) holds any `kyc.*` function. COMPLIANCE's assignment was
not modified — the seed already granted COMPLIANCE all four functions, matching Decision 5 and the
SPEC-01 role matrix exactly; no discrepancy required reporting (the earlier-suspected
Decision-5-vs-SPEC-01 mismatch was resolved by reading the live seed directly, which already
implements Decision 5's three-function decision model).

## 8. Role-matrix verification (real PostgreSQL + real HTTP, no mocked authorization)

Suite: `test/v1-admin-authorization-kyc-01.integration.spec.ts`, 29 tests, all passing. Sessions
are minted via the real `A2WorkforceSessionService.establish()` against real
`A2FinanceRoleAssignment` rows (role key assigned directly in Postgres, exactly as production
role grants work) — no synthetic principal injection, no mocked `AuthorizationService`.

| Role | `GET /kyc` | `POST kyc-assessment` (review/approve/reject) |
|---|---|---|
| SUPER_ADMIN | 200/404 (business-state-dependent, never 401/403) | 201 on all three |
| COMPLIANCE | 200/404 | 201 on all three |
| FINANCE_AUDITOR | 200/404 (view only) | 403 on all three |
| FINANCE_PREPARER | 403 | 403 on all three |
| FINANCE_CONTROLLER | 403 | 403 on all three |
| OPERATIONS | 403 | 403 on all three |
| AGENT_NETWORK_MANAGER | 403 | 403 on all three |
| RISK_FRAUD | 403 | 403 on all three |
| CUSTOMER_SERVICE | 403 | 403 on all three |
| TREASURY | 403 | 403 on all three |
| real AGENT bearer token | 401/403 (wrong principal type, pre-existing guard behavior) | not separately re-tested (identical guard path) |
| unauthenticated | 401 | 401 |

## 9. FINANCE_AUDITOR proof

Test `A3` proves FINANCE_AUDITOR can read `GET /customers/:id/kyc` (404 on a fresh customer — a
business-logic response, never 401/403 — proving the `kyc.view` function check passed). Test `B3`
proves the SAME FINANCE_AUDITOR session is denied 403 on all three `POST
/customers/:id/kyc-assessment` outcomes (PENDING/APPROVED/REJECTED) — FINANCE_AUDITOR is
view-only and holds none of `kyc.review`/`kyc.approve`/`kyc.reject`, matching the catalogue.

## 10. RISK_FRAUD proof

Test `D1` proves RISK_FRAUD is denied 403 on `GET /kyc` and on all three `POST
/kyc-assessment` outcomes (PENDING/APPROVED/REJECTED) — RISK_FRAUD holds no `kyc.*` function in
the catalogue, and this task did not expand RISK_FRAUD into KYC/AML in any way (no catalogue
change was made for RISK_FRAUD, confirmed by `git diff` touching nothing in
`authorization-catalogue.seed.ts`).

## 11. SUPER_ADMIN proof

Test `B1` proves a real local-admin-login SUPER_ADMIN session can review (PENDING), approve, and
reject (after returning to PENDING, per the pre-existing state machine — see §14) a customer's KYC
assessment, end to end over real HTTP against real Postgres. Test `G1` additionally proves full
business-behavior continuity: SUPER_ADMIN creates a PENDING then an APPROVED assessment, and a
subsequent `GET /kyc` reflects the latest persisted state (`status: 'APPROVED'`, `level:
'LEVEL_2'`) — the authorization change does not alter what the service persists or returns.

## 12. 401 vs 403 proof

- Test `A5`/`B5`: a genuinely unauthenticated request to both routes returns 401, not 403.
- Test `A6`: a real AGENT bearer token (wrong principal type entirely) is rejected with
  401/403 at the `RuntimeAccessGuard`/route-policy layer, before the controller's new check is
  ever reached — pre-existing, unaffected by this task.
- Every authenticated-but-under-entitled workforce principal (FINANCE_AUDITOR on
  review/approve/reject; FINANCE_PREPARER/FINANCE_CONTROLLER/OPERATIONS/AGENT_NETWORK_MANAGER/
  RISK_FRAUD/CUSTOMER_SERVICE/TREASURY on everything KYC) gets 403, not 401 — no `deniedStatus`
  override was requested for this brand-new check, so
  `AuthorizationService.requireFunction()`'s default semantics apply: `UNAUTHENTICATED` → 401,
  every other denial reason (including `FUNCTION_MISSING`) → 403. `FUNCTION_MISSING` is never
  collapsed back into 401 — the exact regression class V1-ADMIN-AUTHORIZATION-READ-SURFACE-01 §6
  previously corrected elsewhere and this task does not reintroduce here.

## 13. Exact code changes

File: `src/customer/customer.controller.ts` (62 insertions, 3 deletions). Summary:

1. Import changed from `CustomerStatus` only to `CustomerKycStatus, CustomerStatus`.
2. New const `KYC_ASSESSMENT_FUNCTION_BY_STATUS: Record<CustomerKycStatus, string>` mapping
   `NOT_STARTED`/`PENDING` → `'kyc.review'`, `APPROVED` → `'kyc.approve'`, `REJECTED` →
   `'kyc.reject'`, with a detailed comment explaining the derivation rationale.
3. `createKycAssessment` made `async`, gained `@Req() req: AuthenticatedRequest`, and now calls
   `await this.requireKycFunction(req, KYC_ASSESSMENT_FUNCTION_BY_STATUS[dto.status])` before
   delegating to `this.customerService.createKycAssessment(id, dto)` (service call itself
   unchanged).
4. `getKyc` made `async`, gained `@Req() req: AuthenticatedRequest`, and now calls `await
   this.requireKycFunction(req, 'kyc.view')` before delegating to
   `this.customerService.getKyc(id)` (unchanged).
5. New private helper `requireKycFunction(req, functionCode): Promise<void>`:
   - Throws `UnauthorizedException('Authentication required')` if no principal resolved (401).
   - Returns silently (no-op) if `principal.type === 'CUSTOMER'` (see §6 for rationale).
   - Otherwise calls `this.auth.requireFunction(principal, functionCode, 'kyc', ['OPERATOR',
     'SERVICE', 'PRIVILEGED'])` with no `deniedStatus` override, so default 401/403 semantics
     apply (see §12).
6. Extensive inline documentation comments explaining both the status-derivation rationale and
   the CUSTOMER-exemption rationale, cross-referencing Decision 4/Decision 5 and
   Read-Surface-01's flagged gap.

No change to `customer.service.ts`, any DTO, any entity, any enum, or any migration.

## 14. Exact tests added/run

New file: `test/v1-admin-authorization-kyc-01.integration.spec.ts` — 29 tests, all passing,
organized as:

- **A** (8 tests): `GET /kyc` requires `kyc.view` — SUPER_ADMIN/COMPLIANCE/FINANCE_AUDITOR
  succeed; the seven non-KYC roles are denied 403; unauthenticated is 401; a real AGENT token is
  denied.
- **B** (11 tests): `POST /kyc-assessment` requires the status-derived function — SUPER_ADMIN/
  COMPLIANCE succeed on review+approve+reject; FINANCE_AUDITOR and the seven non-KYC roles are
  denied 403 on all three; unauthenticated is 401.
- **C** (2 tests): `kyc.approve` and `kyc.reject` never conflate — a principal granted ONLY
  `kyc.approve` (via a dedicated, test-only `authorization_roles`/`authorization_role_functions`
  row pair, bypassing any role bundle) can approve but is denied 403 on reject, and vice versa.
  A real SUPER_ADMIN session performs only the PENDING review steps required by the pre-existing
  KYC state machine (`CustomerService.assertKycTransition`: NOT_STARTED→PENDING,
  PENDING→APPROVED|REJECTED, APPROVED|REJECTED→PENDING — direct APPROVED↔REJECTED is not a valid
  transition), so the single-function principal under test is exercised ONLY on its own decision
  function, and the sibling-function denial is proven to be an AUTHORIZATION 403, never a
  business-rule 409.
- **D** (1 test): RISK_FRAUD denied 403 on view, review, approve, and reject.
- **F** (2 tests): CUSTOMER self-access unaffected — a real customer-password login session
  reading its own `/kyc` still reaches the service layer (404 on a fresh customer, not 401/403);
  the same session reading a different customer's `/kyc` is still denied by the pre-existing,
  unmodified `customerAccess: 'SELF'` policy.
- **G** (1 test): business behavior unchanged — SUPER_ADMIN's real PENDING→APPROVED sequence
  persists and is reflected on a subsequent `GET /kyc`.

Regression suites run (real PostgreSQL + real HTTP, unmodified):
`test/v1-admin-full-surface-audit-01-auth-propagation.integration.spec.ts`,
`test/v1-harden-01-support-adversarial.integration.spec.ts`,
`test/v1-admin-authorization-read-surface-01.integration.spec.ts`,
`test/v1-admin-authorization-hardening-01.integration.spec.ts`,
`test/v1-admin-authorization-foundation-01.integration.spec.ts`,
`test/s-fix-01-customer-lifecycle-authorization.integration.spec.ts` — **90/90 passing**, zero
regressions.

Full unit suite (`npx jest --maxWorkers=2`, excludes `*.integration.spec.ts`): **174 suites /
1823 tests passing**, including `test/customer.service.spec.ts` (pure business-logic coverage,
untouched by this task).

Full real-PostgreSQL integration suite (`npm run test:pg`, batched across 7 processes,
concurrency 2): **98 files / 1805 tests passing, 0 failures**, including the new KYC-01 suite and
every other pre-existing integration suite in the repository.

`npm run build` (`nest build`): clean, 0 errors. `npx tsc --noEmit`: clean, 0 errors.

## 15. Failures encountered and resolved during this task

- No test failures remain in the final state. Two classes of failure were encountered and fixed
  during development, both resolved before any commit:
  1. **Environment setup, not a code defect**: the sandbox had no `node_modules` (excluded from
     snapshots) and no running PostgreSQL server; both were restored this session (`npm ci`; a
     real PostgreSQL 16 server built from the `pgserver` PyPI package, initialized with the
     project's expected `monienaija`/`monienaija-pw` credentials on `127.0.0.1:5432`) and a local
     `.env` was created from `.env.example` with the V1-ADMIN-LOCAL-LOGIN-01 local-dev workforce
     block enabled (`A2_WORKFORCE_ENABLED=true` plus `A2_FINANCE_ROLES_JSON` etc.) so the existing
     `loginSuperAdmin()`-based suites could run at all. `.env` is gitignored and was not committed.
  2. **Test-authoring state-machine mistakes** (not production-code defects): the first draft of
     the new test suite attempted invalid KYC status transitions (e.g. `APPROVED` directly to
     `REJECTED`), which `CustomerService.assertKycTransition` — pure, pre-existing, untouched
     business logic — correctly rejects with 409. The tests were corrected to respect the
     pre-existing state machine (see §14, section C); no production code was changed to
     accommodate this.

## 16. Remaining KYC authorization gaps / next required task

- **No remaining endpoint-level gap for KYC specifically**: both KYC endpoints
  (`GET /customers/:id/kyc`, `POST /customers/:id/kyc-assessment`) now enforce the catalogue
  function matching their actual action, for every non-CUSTOMER principal type. No endpoint
  governed by the `kyc.*` catalogue functions remains reachable via generic
  OPERATOR/PRIVILEGED/SERVICE principal-type authorization alone.
- **CUSTOMER self-access to `/kyc` is intentionally left on the pre-existing `customerAccess:
  'SELF'` path**, not a new or newly-discovered gap — this is the same posture every other
  customer self-service GET on this controller already has, and changing it would be an
  unauthorized business-behavior change outside this task's approved scope. If a future task
  decides CUSTOMER principals should be excluded from `/kyc` entirely (e.g. customers should not
  see their own raw KYC decision/reason), that is a product decision requiring explicit PO
  sign-off, not an authorization defect.
- **No mandatory independent second reviewer was added**, per the explicit DO-NOT list — a single
  COMPLIANCE/SUPER_ADMIN principal may both review and decide the same assessment. If V1 or a
  later version requires maker/checker separation for KYC decisions, that is new, explicitly
  out-of-scope work requiring its own PO-approved task.
- **SUPPORT authorization was not implemented** (SUPPORT was never in the generic customer route
  policy's `allowedPrincipalTypes` and remains excluded at the guard level, independent of this
  task) — any SUPPORT-specific KYC read/assist capability (e.g. a restricted view for a support
  ticket) is unaddressed and would need its own task if ever required.
- **Suggested next task** (not started, not in scope here): if the product wants a broader sweep
  of the remaining customer-domain GET surface (addresses, identity documents, profile) for
  function-level gating analogous to this task and Read-Surface-01, that would be a new,
  explicitly scoped task — this task deliberately did not touch those endpoints.
