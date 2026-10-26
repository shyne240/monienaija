# V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01 — Implementation Report

## 1. Executive summary

This task implements the Product-Owner-approved decisions from
`docs/V1/V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-DECISION-01.md` by closing the three
catalogue gaps `V1-ADMIN-AUTHORIZATION-CUSTOMER-READ-01` deliberately left open.
Three new authorization-catalogue functions — `customer.view_address`,
`customer.view_contact_methods`, `customer.view_identity_documents` — were added to
`authorization-catalogue.seed.ts` with the exact approved role assignments, and
`CustomerController`'s three corresponding GET endpoints
(`/customers/:id/addresses`, `/customers/:id/contact-methods`,
`/customers/:id/identity-documents`) now call
`AuthorizationService.requireFunction()` for workforce principals, using the same
CUSTOMER-self-service-exemption pattern already established by
`requireCustomerViewFunction`/`requireKycFunction`. No route-policy, authentication,
ownership-check, or business-logic changes were made. A dedicated 48-test
integration suite (real PostgreSQL + real HTTP, no mocked role/function data)
proves all 12 required points. The pre-existing `V1-ADMIN-AUTHORIZATION-CUSTOMER-READ-01`
regression suite was amended in exactly one place (Section D, which previously
asserted the now-intentionally-superseded "not migrated" behavior for these three
routes) and now asserts the new, correct behavior; all of its other assertions —
including CUSTOMER self-service, 401 semantics, and `customer.view` enforcement on
`list`/`get`/`getProfile` — are unchanged and still pass. Full unit suite (1823
tests), full Postgres integration suite (100 files), `npm run build`, and
`npx tsc --noEmit` all pass cleanly on the final state.

## 2. Baseline and final commits

- **Baseline (start of this task):** `ade12f02908e66a196c41a4f3dfc26b06467e430` —
  the final, verified, pushed commit of `V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-DECISION-01`
  on `arena/01a10374-monienaija`. Confirmed via `git fetch` + `git rev-parse HEAD` /
  `git rev-parse origin/arena/01a10374-monienaija` to be identical immediately before
  any implementation work began this session (after recovering from a stale local
  sandbox HEAD — see §12).
- **Final commit (this task):** recorded in §10/§13 of the final response, committed
  as `feat(v1-admin-authz): enforce customer PII permissions`, pushed to
  `arena/01a10374-monienaija`.

## 3. Migration / catalogue changes

No new SQL migration file was required. The authorization-catalogue schema
(`src/migrations/1785753600083-CreateAuthorizationCatalogue.ts`) is schema-only and
already supports arbitrary `function_code` values with no fixed enum — new
functions/role-assignments are added purely via
`src/authorization-catalogue/authorization-catalogue.seed.ts`, consumed idempotently
at application bootstrap by the existing `AuthorizationCatalogueSeedService`
(count-based, insert-missing-only, `findOne` check before every insert — see
`seedFunctions`/`seedRoleFunctions`). This is the established "migration mechanism"
for this catalogue (mirrors the pre-existing `CapabilitySeedService` convention) and
was followed exactly, with no modification to the seed service itself.

Added to `AUTHORIZATION_FUNCTION_SEED` (CUSTOMER domain):

| functionCode | sensitivity | v1Status | assignable |
|---|---|---|---|
| `customer.view_address` | READ | IMPLEMENTED | true |
| `customer.view_contact_methods` | READ | IMPLEMENTED | true |
| `customer.view_identity_documents` | **SENSITIVE** | IMPLEMENTED | true |

`customer.view_identity_documents` is classified `SENSITIVE` (not `READ`) because
identity-document records carry government document numbers, materially more
sensitive than address/contact PII — this also structurally prevents it from ever
being assignable to a `read_only = true` role (FINANCE_AUDITOR) without an explicit,
separate decision, consistent with the approved narrower matrix.

Added to `AUTHORIZATION_ROLE_FUNCTION_SEED` (10 new rows, all `accessType: VIEW`):

- `customer.view_address`: SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS, COMPLIANCE, CUSTOMER_SERVICE
- `customer.view_contact_methods`: SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS, COMPLIANCE, CUSTOMER_SERVICE
- `customer.view_identity_documents`: SUPER_ADMIN, COMPLIANCE

No existing function, role, or role/function assignment row was modified, removed,
or reordered. The seed is idempotent (bootstrap-time `findOne`-before-insert, as for
every pre-existing row) and was verified to produce no duplicate rows across
multiple full-suite runs (each integration spec reseeds via
`AuthorizationCatalogueSeedService`'s bootstrap path against a freshly truncated
schema per test file, and the new rows seeded correctly in every one of the ~190
integration test files exercised in §9/§11 without conflict).

## 4. Exact endpoint-to-function mapping

Reinspected the live `src/customer/customer.controller.ts` and
`src/authorization/route-policy-registry.ts` fresh this task (not assumed from a
prior session). Route spellings matched the task brief exactly — no discrepancy
found:

| Method & path | Function required (workforce only) |
|---|---|
| `GET /customers/:id/addresses` | `customer.view_address` |
| `GET /customers/:id/contact-methods` | `customer.view_contact_methods` |
| `GET /customers/:id/identity-documents` | `customer.view_identity_documents` |

`customer.view` was not touched or repurposed; it continues to gate only
`GET /customers`, `GET /customers/:id`, `GET /customers/:id/profile` exactly as
before.

The pre-existing generic route-policy entry for
`path.startsWith('/api/v1/customers/')` (allowedPrincipalTypes `['CUSTOMER',
'OPERATOR', 'SERVICE', 'PRIVILEGED']`, `customerAccess: 'SELF'`) was **not
modified** — it already covers these three routes and continues to perform the
outer authentication/principal-type/self-ownership gate exactly as before. The new
function checks are added entirely inside the controller, as an additional,
narrower AND-combined constraint on top of that unchanged route policy — the same
pattern `requireCustomerViewFunction`/`requireKycFunction` already established.

## 5. Ten-role authorization matrix

| Role | `customer.view_address` | `customer.view_contact_methods` | `customer.view_identity_documents` |
|---|---|---|---|
| SUPER_ADMIN | ALLOW | ALLOW | ALLOW |
| FINANCE_PREPARER | DENY | DENY | DENY |
| FINANCE_CONTROLLER | DENY | DENY | DENY |
| FINANCE_AUDITOR | ALLOW | ALLOW | **DENY** |
| OPERATIONS | ALLOW | ALLOW | DENY |
| AGENT_NETWORK_MANAGER | DENY | DENY | DENY |
| COMPLIANCE | ALLOW | ALLOW | ALLOW |
| RISK_FRAUD | DENY | DENY | DENY |
| CUSTOMER_SERVICE | ALLOW | ALLOW | DENY |
| TREASURY | DENY | DENY | DENY |

This matches the approved matrix in `V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-DECISION-01.md`
verbatim; no broadening by principal type, existing `customer.view` grant, or
administrative seniority was applied anywhere.

## 6. SUPER_ADMIN / COMPLIANCE identity-document proof

New suite `test/v1-admin-customer-pii-authorization-implementation-01.integration.spec.ts`:

- `A3` — SUPER_ADMIN and COMPLIANCE each independently succeed (200) on
  `GET /customers/:id/identity-documents` with a real seeded role assignment and a
  real bearer session (not mocked).
- `B1` — SUPER_ADMIN and COMPLIANCE each succeed on **all three** PII endpoints in
  the same test, proving the full grant, not just identity-documents in isolation.

Both passed. See §10 for exact run results.

## 7. FINANCE_AUDITOR denial proof

- `A4` / `A2 [identity-documents]` — FINANCE_AUDITOR is explicitly included in the
  identity-documents deny list and asserted 403.
- `B2` — a single test proves, in sequence against the same customer, that
  FINANCE_AUDITOR succeeds (200) on `/addresses` and `/contact-methods` but is
  denied (403) on `/identity-documents` — the exact narrower-than-`customer.view`
  asymmetry the approved decision calls for (FINANCE_AUDITOR already holds
  `customer.view` and would hold the two PII-view functions, but explicitly not the
  identity-document one).

Both passed.

## 8. CUSTOMER self-service proof

- `C1` — a real CUSTOMER session (real password login via
  `POST /customers/sessions`, real `A2`-style bearer validation) reads its own
  `/addresses`, `/contact-methods`, `/identity-documents` and succeeds (200) with no
  catalogue function required, for all three routes.
- `C2` — the same CUSTOMER session is denied (403) when attempting to read a
  **different** customer's sub-resources on all three routes — the pre-existing
  `customerAccess: 'SELF'` route-policy check, completely unaffected by this task.

No change was made to `CustomerAuthenticationService`, session issuance, the route
policy's `customerAccess: 'SELF'` check, response DTOs/shape, or
`CustomerService.listAddresses`/`listContactMethods`/`listIdentityDocuments`
business logic. Both tests passed.

## 9. 401 / 403 proof

- `D1` — unauthenticated requests to all three routes return 401, never 403.
- `D2` — a genuine, fully-authenticated workforce session that lacks the required
  function (TREASURY) returns 403 on all three routes, never 401 — proving
  `FUNCTION_MISSING` never collapses into 401 (no `deniedStatus` override is used on
  the new `requirePiiFunction` helper, matching the brand-new-check convention
  already established by `requireCustomerViewFunction`/`requireKycFunction`).
- `B4` — a real AGENT bearer token (wrong principal type entirely) is denied with
  401 or 403 on all three routes (the pre-existing `allowedPrincipalTypes` AND-gate,
  unaffected).

All passed.

## 10. Focused and regression test results

**Focused new suite** —
`test/v1-admin-customer-pii-authorization-implementation-01.integration.spec.ts`
(real PostgreSQL + real HTTP, `npx jest --config jest.integration.config.js
--runInBand`):

```
Test Suites: 1 passed, 1 total
Tests:       48 passed, 48 total
```

Covers, with real seeded catalogue data (no mocked role/function assignments): all
12 required proof points — per-endpoint function enforcement (A), SUPER_ADMIN/
COMPLIANCE full access (B1), FINANCE_AUDITOR address/contact-methods-allow +
identity-documents-deny (B2), OPERATIONS/CUSTOMER_SERVICE same asymmetry (B3), the
five deny-all-three roles (A2/A4), no OPERATOR-type-only pass-through (B4, an AGENT
token denied despite being a non-CUSTOMER principal type), CUSTOMER self-service
preserved (C1/C2), 401 vs 403 semantics (D1/D2), and KYC-01/Customer-Read-01
behavior unaffected (E1–E3).

**Regression suites** (`npx jest --config jest.integration.config.js --runInBand`
against the four most relevant pre-existing authorization suites):

```
PASS test/v1-admin-authorization-hardening-01.integration.spec.ts
PASS test/v1-admin-authorization-kyc-01.integration.spec.ts
PASS test/s-fix-01-customer-lifecycle-authorization.integration.spec.ts
PASS test/v1-admin-authorization-customer-read-01.integration.spec.ts

Test Suites: 4 passed, 4 total
Tests:       118 passed, 118 total
```

`v1-admin-authorization-customer-read-01.integration.spec.ts` required one
intentional amendment: its Section D previously asserted the (now superseded)
"deliberately not migrated" behavior for `/addresses`, `/contact-methods`,
`/identity-documents` — i.e. that a TREASURY workforce session could reach these
routes with 200 regardless of `customer.view`. That assertion is the direct, approved
subject of this task and was updated to assert the new, correct behavior (TREASURY
now correctly receives 403, since it holds none of the three new functions); the
test's docstring and `describe` block were updated to explain the amendment and
point to the new dedicated suite. No other assertion in that file — including every
`customer.view` enforcement check on `list`/`get`/`getProfile`, every CUSTOMER
self-service check, and every 401/403 check — was changed, and all still pass.

## 11. Unit / Postgres / build / typecheck results

- **`npx jest --maxWorkers=2`** (full unit suite):
  ```
  Test Suites: 174 passed, 174 total
  Tests:       1823 passed, 1823 total
  ```
- **`npm run test:pg`** (full Postgres integration suite, `scripts/run-pg-integration-tests.js`):
  ```
  === PG integration suite: 7 batch(es), 100 files, concurrency=2 — all passed ===
  ```
  All 100 integration spec files passed, including the new focused suite and all
  four regression suites listed in §10.
- **`npm run build`** (`nest build`): succeeded with no errors or warnings.
- **`npx tsc --noEmit`**: succeeded with no errors.

No test, build, or typecheck result reported here was skipped, estimated, or
assumed — every command above was executed this session against the real local
PostgreSQL instance and the real compiled/typechecked source tree.

## 12. Remaining gaps and out-of-scope items

- As directed, this task did **not** touch `AdminCustomerController`, SUPPORT
  authorization/governance, `RoutePolicyRegistry` (no entries added, removed, or
  restructured — the existing generic `/api/v1/customers/*` policy already covered
  these three routes), financial maker/checker machinery, KYC authorization/business
  logic, masking/projection design, identity-verification workflow, customer mobile,
  Admin Web, or any unrelated role assignment/financial business logic.
- No approval workflow or additional complexity was added beyond the three plain
  function grants, as explicitly directed — including for SUPER_ADMIN/COMPLIANCE
  identity-document access, which remains a simple VIEW-function grant with no
  additional gate.
- A pre-existing, unrelated environment defect was encountered and resolved this
  session (not a gap in the implementation): the sandbox does not persist
  `node_modules/`, the local Postgres instance, or `.env` across session
  boundaries, and local git HEAD was again found stale relative to the remote tip
  at the start of this task (the fourth such occurrence on this project). Both were
  diagnosed and safely recovered before any implementation work began — recovery
  was a plain, non-destructive `git reset` to the confirmed-correct remote tip
  after a forensic sha256 comparison proved the working tree already matched
  origin.
- No other gaps are known. The three approved functions are fully wired,
  catalogue-seeded, tested end-to-end against real PostgreSQL and real HTTP, and
  verified not to regress any existing authorization surface.

## 13. Final security assessment

The three previously-undocumented catalogue gaps on customer PII sub-resources are
now closed with the exact, Product-Owner-approved, least-privilege role matrix:
address and contact-method PII is visible to five specific roles
(SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS, COMPLIANCE, CUSTOMER_SERVICE), while the
more sensitive identity-document PII (government document numbers) is visible to
only two (SUPER_ADMIN, COMPLIANCE) — a deliberately narrower set than even
`customer.view` itself. No workforce role gains access by virtue of principal type
alone (`OPERATOR`-type roles without the specific function, e.g. FINANCE_PREPARER,
FINANCE_CONTROLLER, AGENT_NETWORK_MANAGER, RISK_FRAUD, TREASURY, remain denied on
all three routes), and a role holding one of the two broader PII functions does not
inherit the narrower identity-document function (proven directly for
FINANCE_AUDITOR, OPERATIONS, CUSTOMER_SERVICE). `FUNCTION_MISSING` correctly remains
a 403, never collapsing into an authentication-shaped 401, preserving accurate HTTP
semantics for genuinely authenticated-but-unauthorized workforce sessions. CUSTOMER
self-service is fully preserved — a customer continues to read its own PII
sub-resources with no function requirement, and cross-customer access remains
blocked exactly as before, via the pre-existing, unmodified `customerAccess: 'SELF'`
route-policy check. The implementation is additive and minimally invasive: it adds
one small, parameterized controller helper reusing the task's own established
pattern, three catalogue rows, and ten role/function assignment rows — no
authentication, route-policy, business-logic, or response-shape changes were made
anywhere in the system.
