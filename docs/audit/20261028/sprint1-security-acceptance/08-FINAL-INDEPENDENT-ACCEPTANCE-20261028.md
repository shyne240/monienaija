# Sprint 1 P0 — Independent Security Acceptance Report

**Reviewer:** Arena 4, independent follow-up  
**Review date:** 2026-10-28  
**Target branch:** `arena/8e59e188-monienaija`  
**Application SHA reviewed:** `5a5ad8a5e130da1dc598508914a0a14e48c8735f`  
**Target documentation HEAD:** `ef596ee1922ce7be753014ad061f949e0552f9c0`  
**Audited baseline:** `2fe5a2e9c882fe718370e582e13eb539cde8ca74`  
**Recommendation:** **NO-GO for Sprint 1 security acceptance / production.**

## 1. Executive decision

The three authorization patches are integrated, and independent focused real-HTTP/PostgreSQL tests pass on the exact application SHA. P0-01's client-supplied audit attribution issue is fixed in code and its full mutation workflow was tested; P0-03 is fixed with matching route-policy and controller checks. P0-02's authorization boundary is also enforced, with the expected role/function denies and PHONE masking.

However, the notification delivery response still returns the stored rendered `message` and raw `lastError`. An independently added assertion to the existing real-PG HTTP test reproduced the rendered message in the response. This conflicts with the requested message-payload minimization, and the content can include transaction amounts or other user-specific information. Do not accept this response projection until it is narrowed and retested.

Compliance acceptance is also conditional on product/security decisions: a valid function holder is not limited to assigned customers (D-01 remains open), and global case-number uniqueness provides a 409 existence oracle across customer/category boundaries. These are explicitly distinguished from the confirmed P0-02 projection defect; they are not silently treated as resolved.

### Per-P0 verdicts

| Finding | Verdict | Code correctness | Policy / release status |
|---|---|---|---|
| P0-01 — Compliance authorization | **CONDITIONAL PASS** | Dedicated workforce guard on all 11 routes; active DB role-function and access-type intersection; category separation; customer/case binding; actor derived from session; audit/dashboard filtering. Focused adversarial PG tests passed. | **Not accepted pending D-01/D-04**, especially whether roles are global or worker/customer-assignment scoped and whether a distinct read grant is needed. Global case-number collision remains a low-severity oracle. |
| P0-02 — Notification deliveries | **FAIL** | `notification.view_deliveries` is checked before query validation; role/type denials, 401/403 behavior, and PHONE masking passed focused PG checks. No grant expansion found. | **Material projection defect:** response includes `message` and unsanitized `lastError`. Remove or safely classify/redact before acceptance. |
| P0-03 — Limit diagnostics | **PASS** | `limit.view` required in both exact GET route policies and controller, before filters/query; read routes do not imply release; focused PG suite passed. | Role grants match Admin gate. No unresolved release-scope expansion found. |
| Previous actor-attribution finding (P0-04 candidate) | **PASS (fix verified)** | Client `actor`/`uploadedBy` is ignored for all service mutations; authenticated principal ID is stored. End-to-end case workflow and database audit/history assertions passed. | Keep server-derived actor invariant in future DTO/service changes. |

**Overall result: NO-GO.** P0-02 fails a stated data-minimization requirement. P0-01 remains conditional on unresolved access policy. Do not infer production readiness from the successful focused suites.

## 2. Independent provenance and diff review

### Exact remote ancestry

I fetched the remote refs without switching to or modifying another branch and inspected the target diff from the audited baseline, rather than relying on the integration record.

- `origin/arena/8e59e188-monienaija` was at documentation commit `ef596ee1922ce7be753014ad061f949e0552f9c0`.
- `ef596ee` has parent `5a5ad8a5e130da1dc598508914a0a14e48c8735f`; the docs commit did not change the reviewed application tree.
- Application commit `5a5ad8a` has parent `bebd7bdd36ac48b1bb865c5d6d5eba6c310f6074` and is the Arena 2 notification integration merge.
- The baseline and implementation commits are ancestors of the application SHA: baseline `2fe5a2e`, Arena 1 `22d3ec8`, Arena 2 `cdf5203`, Arena 3 `a7898e2`.
- Diff from baseline to app SHA: **32 files, 2,946 insertions, 169 deletions**. Relevant changes were inspected in source, tests, route policy, authorization service, audit service, dashboard paths, role seed and Admin Web.
- No reset, rebase, cherry-pick, force-push or other history rewrite was performed by this review.

Remote source-ref preservation at review time: `arena/92fd33dd-monienaija` remained at `22d3ec8254f8e641c0ae4d74c4f905858b417271` (Arena 1) and `arena/ea070127-monienaija` remained at `cdf52030f0cae09f169a1fb333e9292f4d74f135` (Arena 2). Arena 3 commit `a7898e2` is present in the target ancestry; no separate fetched source ref contained it at review time (integration record says Arena 3 was already on the integration branch). No source branch was changed by Arena 4.

### Local workspace preservation note

The pre-existing main checkout was already on `arena/870f970d-monienaija` at `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510`, while its remote branch was at `d08696d6d783889fbc676e7e672143894d284eb4`; the main checkout also contained extensive pre-existing modified/untracked application files. I did not switch, reset, clean, stash, stage, or commit those files. Acceptance documentation was prepared in a separate worktree based on the remote pinned-branch tip, then fast-forward-pushed to that branch. The exact final remote SHA is recorded in §10. The main checkout's pre-existing changes remain untouched.

## 3. Compliance case authorization — P0-01

### What is enforced

The integrated route policy has a specific compliance-case matcher before the generic `/api/v1/customers/` policy. `CustomerComplianceAccessGuard` is attached at controller class level, covering these **11 endpoints**:

1. `POST /api/v1/customers/:id/compliance-cases`
2. `GET /api/v1/customers/:id/compliance-cases`
3. `GET /api/v1/customers/:id/compliance-cases/:caseId`
4. `PATCH /api/v1/customers/:id/compliance-cases/:caseId`
5. `POST /api/v1/customers/:id/compliance-cases/:caseId/comment`
6. `GET /api/v1/customers/:id/compliance-cases/:caseId/comments`
7. `POST /api/v1/customers/:id/compliance-cases/:caseId/evidence`
8. `GET /api/v1/customers/:id/compliance-cases/:caseId/evidence`
9. `POST /api/v1/customers/:id/compliance-cases/:caseId/assignment`
10. `GET /api/v1/customers/:id/compliance-cases/:caseId/assignments`
11. `GET /api/v1/customers/:id/compliance-cases/:caseId/history`

The guard checks live, active `authorization_roles` and `authorization_role_functions` rows and intersects them with the current session scope. Reads allow `VIEW` or `EXECUTE`; mutations require `EXECUTE`; `INITIATE` or `APPROVE` alone is denied. `compliance.manage_case` yields the explicit non-FRAUD set; `risk_fraud.manage_fraud_case` yields FRAUD only. Both functions are needed for the union. Unknown/future categories do not silently join either set.

Every service read/write validates customer UUID and binds case ID, customer ID, and authorized category in the case lookup. Wrong customer/case, category-hidden and nonexistent case lookups use 404-equivalent behavior. Child-record reads/writes validate the parent case first. Mutation services take a guard-created `ComplianceCaseAccess`, not a client-provided access object. DTO `actor`/`uploadedBy` values remain wire-compatible but are ignored; `principalId` supplies opened-by, comment, evidence-uploaded-by, assignment, history and business-audit actors.

The guard audits allow/deny decisions. Generic audit listing filters compliance case records, case-route authorization decisions, and `COMPLIANCE_` policy reason codes before pagination. The HTTP audit controller does not expose the internal `includeComplianceCaseRecords` option as a query override. Compliance and fraud dashboard summaries call the same live grant/access-type check and query only their category.

### Independently inspected 11-role function grant matrix

This table is from `AUTHORIZATION_ROLE_FUNCTION_SEED` (the integrated diff did not change that catalogue file); the real-PG endpoint tests also use the persisted authorization tables and seed. `—` means no grant in the seed.

| Seeded role (11) | `compliance.manage_case` | `risk_fraud.manage_fraud_case` | `notification.view_deliveries` | `limit.view` |
|---|---:|---:|---:|---:|
| SUPER_ADMIN | EXECUTE | — | VIEW | VIEW |
| FINANCE_PREPARER | — | — | — | VIEW |
| FINANCE_CONTROLLER | — | — | — | VIEW |
| FINANCE_AUDITOR | — | — | VIEW | VIEW |
| OPERATIONS | — | — | VIEW | — |
| AGENT_NETWORK_MANAGER | — | — | — | VIEW |
| COMPLIANCE | EXECUTE | — | — | — |
| RISK_FRAUD | — | EXECUTE | — | — |
| CUSTOMER_SERVICE | — | — | — | — |
| TREASURY | — | — | — | — |
| ADMINISTRATOR | — | — | — | — |

The HTTP tests additionally deny unentitled workforce roles and genuine CUSTOMER, AGENT, AGGREGATOR and SUPPORT identity types. Super Admin does not receive the fraud function by its non-fraud grant. The customer/case tests exercise category denial in both directions.

### Independent probes and remaining boundary

- The full focused compliance integration spec passed cross-customer/case-pair checks across reads and writes, role denials on all handlers, category separation, VIEW-vs-EXECUTE, audit/history actor binding, audit filtering, dashboard filtering, live grant revocation and transaction rollback on audit failure.
- I added a temporary test only in the isolated review worktree: the same COMPLIANCE session created cases for two different valid customers; the first POST returned 201. This confirms the code does **not** implement worker-to-customer assignment scoping.
- The same temporary real-HTTP/PG probe created an identical caller-chosen `caseNumber` under a second customer. It returned **409 Conflict**. The conflicting lookup is global and includes soft-deleted cases (`findOne({where:{caseNumber}, withDeleted:true})`); the database uniqueness constraint is global too. This leaks that the number is already in use, but not the owning customer/category. Treat as a **low-severity identifier-existence oracle (P2)** pending an approved case-number policy, not as proof of cross-customer case-row access.
- An authorized request with malformed customer ID returned 400; a future/unknown category returned 400. An unauthorized workforce caller is denied before service validation. Neither probe returned case data.
- The committed real-PG test asserts generic audit listing cannot be bypassed with `includeComplianceCaseRecords=true`, and dashboard summaries deny roles lacking the category function. It checks both status/count data and audit markers.

### Open acceptance decision

D-01 remains open: exact case role/subresource entitlements, independent read-only permission, and whether access must be assigned by customer/team/case. Current behavior is global within category for a valid function holder: for example, a COMPLIANCE principal with the grant can list/read/write any valid customer's non-FRAUD cases. If D-01 requires worker/customer assignment, this is a **policy-dependent P1 authorization gap**; smallest remediation is to resolve active customer assignments into guard access and enforce that set on list and every case/child query. D-04 remains open on complete taxonomy; the current hard-coded allowlists fail closed for future enum values, which is safe but requires owner ratification.

The Admin screens check the matching function for page/navigation access, but do not model VIEW versus EXECUTE action controls. Seeded current case grants are EXECUTE, so no seeded view-only user is exposed today; once D-01 introduces VIEW-only grants, the UI must hide/disable write controls while retaining the backend 403. The stale Risk/Fraud warning and workflow UX remain Admin follow-up.

## 4. Notification delivery authorization and projection — P0-02

### Authorization results: PASS

`GET /api/v1/internal/notifications/deliveries` calls `requireFunction('notification.view_deliveries')` at the top of the handler before page/filter parsing and before either SQL query. Function access is AND-combined with allowed workforce types. Real unauthenticated requests return 401; authenticated but unentitled roles return 403 `FUNCTION_MISSING`; wrong identity shapes retain the configured 401 convention. Existing grants remain restricted to SUPER_ADMIN, FINANCE_AUDITOR and OPERATIONS. No new function/role grants were added. The old SUPPORT/OPERATOR/SERVICE/PRIVILEGED type-only access is no longer sufficient.

Focused tests confirm invalid filters do not bypass authorization, CUSTOMER/AGENT/AGGREGATOR and missing/malformed tokens are rejected, and PHONE recipient IDs are masked (`8091234567` → `*******567`). Destination and JSON `payload` are not returned; fixed secret sentinels in payload/provider environment are absent. There is no permission expansion.

### Confirmed projection failure: FAIL

The query and JSON projection still select and return `message: r.message` and `lastError: r.last_error`. In the isolated copy of the real-PG HTTP integration test, I added an assertion against its existing fixture; it passed with the response containing:

`Your funding of NGN 5,000.00 has been approved.`

**Reproduction:** as a seeded OPERATIONS (or FINANCE_AUDITOR/SUPER_ADMIN) principal holding `notification.view_deliveries`, seed a `notification_deliveries` row with `message='Your funding of NGN 5,000.00 has been approved.'`, then `GET /api/v1/internal/notifications/deliveries`. The response's `data[].message` includes the plaintext. This is a real HTTP + PostgreSQL reproduction, not a mock. The same code returns raw `last_error`; the reviewed tests do not prove arbitrary provider error strings are secret-free.

**Impact/severity:** **HIGH (P1) data-minimization/disclosure defect.** Any authorized global delivery reader can inspect rendered notification content, which may contain financial amounts, recipient-specific content or other message data. Provider destination and JSON payload are hidden, but returning rendered message defeats that protection for content copied into the body. Raw provider errors add an unverified disclosure surface; no real provider secret was demonstrated in `lastError`.

**Smallest safe remediation:** remove `message` and raw `lastError` from the diagnostics SQL projection and JSON DTO; if support needs failure diagnostics, expose a closed, sanitized error code and aggregate status. Add PG sentinel tests asserting message text, body variables, last-error strings, destination, payload and provider secrets never occur anywhere in response JSON. Do not expose a “preview” until data owners approve its exact schema.

## 5. Limit diagnostics — P0-03

Both exact GET paths (`/api/v1/internal/limit-usages`, `/api/v1/internal/limit-reservations`) declare `requiredFunctions: ['limit.view']` in route policy, before the generic limit prefix. `LimitOperationsController.requireWorkforce` independently checks a workforce type and `principal.scopes.includes('limit.view')` before parsing or passing any query filters. Route resolution strips query strings, and the tests exercise filter variants; a query parameter cannot widen entitlement.

Seeded `limit.view` grants are VIEW-only and limited to SUPER_ADMIN, FINANCE_PREPARER, FINANCE_CONTROLLER, FINANCE_AUDITOR and AGENT_NETWORK_MANAGER. The route type allowlist remains OPERATOR/SERVICE/PRIVILEGED. The `POST /api/v1/internal/limit-reservation-recovery/release` route is not in the exact GET policy; it remains separately PRIVILEGED-only and reasoned/audited. It does not inherit `limit.view` as a mutation grant.

The focused real-PG diagnostics suite passed the role/function denies, projection, read-only invariant and release boundary. The endpoint services remain read-only; no query filter permits writes. **Verdict: PASS.**

## 6. Independent test evidence

All tests/builds below were run against the isolated worktree at exact application SHA `5a5ad8a5e130da1dc598508914a0a14e48c8735f`; the application checkout itself was detached and clean before temporary probe assertions. No test application code was changed.

### Completed, passing

| Suite / check | Exact result | Environment |
|---|---|---|
| Backend unit suite: `./node_modules/.bin/jest --runInBand` | **203/203 suites; 2,042/2,042 tests passed** | Node `v22.22.3`, npm `10.9.8` |
| Admin Web tests: `npm test -- --runInBand` | **26/26 suites; 181/181 tests passed** | Admin Web lockfile-installed dependencies |
| Admin Web type check: `npm run ts:check` | Passed | `tsc` |
| Admin Web production build: `npm run build` | Passed; Vite emitted a >500 kB chunk advisory | Vite 5.4.21 |
| Focused P0 real-HTTP + PostgreSQL specs: compliance authorization, notification delivery authorization, limit diagnostics | **3/3 suites; 52/52 tests passed** | Temporary embedded PostgreSQL 18.4 at `127.0.0.1:5432`; DBs isolated by harness run ID `rf9e3797e467c`; no provider credentials used |
| Additional isolated compliance probes | **1 temporary test passed**, with assertions for first create 201, cross-customer global duplicate 409, invalid customer ID 400, unknown category 400 | Same real HTTP/PG app; test exists only in temporary review worktree |
| Additional notification body probe | **D1 temporary assertion passed**: response contains seeded rendered message text | Same real HTTP/PG app; assertion exists only in temporary review worktree |

### Full PostgreSQL suite attempted but not completed

I attempted the repository's full sequential-batch PostgreSQL runner with `PG_TEST_CONCURRENCY=2` on the disposable embedded database. The overall 1,800-second tool limit was reached before the runner returned a final suite/test aggregate; remaining Jest child processes were terminated, then the temporary server was stopped. The captured partial output showed timeout failures during setup hooks in `v1-003-admin-operational-writes.integration.spec.ts` (21 tests affected by its `beforeAll` exceeding 180 seconds) and `v1-commercial-02-product-catalogue.integration.spec.ts` (one `beforeEach` exceeding 120 seconds). I cannot state an overall count or claim the complete PG suite passed. This does not change the passing 3-suite focused P0 result.

The integration owner's report claims 121/121 PG suites and 2,318/2,318 tests passed on the same application SHA, but that is **owner-supplied evidence, not my completed independent full-suite run**. Independent full PG completion remains a gate for final acceptance.

The intentionally injected audit-trigger error logged during the compliance rollback test and injected failure logs in unrelated suites were expected test scenarios; the focused P0 suites themselves completed successfully.

## 7. Remaining risks and decisions

| Item | Independent finding | Status / consequence |
|---|---|---|
| D-01 — compliance access grants | Whether VIEW is allowed, exact subresource actions, and global vs assignment scope remain unresolved. | Blocks unconditional P0-01 acceptance. |
| D-04 — fraud taxonomy | Current 8 explicit non-FRAUD + FRAUD lists fail closed for unknown categories; product must ratify taxonomy and future change path. | Conditional policy acceptance; do not silently add enum values to a list. |
| Per-worker customer assignment | No assignment is checked. Authorized role is category-scoped but cross-customer/global. | If assignments are required: P1 authorization defect; implement server-side assignment resolution/filtering. |
| Global case-number collision | Real probe returned 409 across customers; service checks all cases including deleted rows. | P2 existence oracle / product identifier decision. Prefer server-generated opaque IDs or an approved tenant/category-aware identifier contract; avoid revealing case details. |
| Scoped audit visibility | Generic audit and audit-trail views hide case records/reason codes from all readers; internal maturity consumer retains trusted count-only inclusion. | Safer than disclosure but authorized auditors lack a scoped review surface; build an approved separately gated audit view. |
| Compliance UX | Existing screens gate function presence, not access type/action entitlements; stale Risk/Fraud messaging and access-aware controls remain. | Backend denies remain authoritative; update UI before enabling VIEW-only grants. |
| Notification dark launch | No live SMS/email provider delivery or production activation was exercised; email registry/worker dark-launch constraints, no retry endpoint, and deferred retry remain. | No production readiness evidence; do not activate workers or providers from this acceptance. |
| Production | No production DB, external provider, deployment, live customer or financial operation was used. No production migration/deployment was performed. | Production readiness is explicitly **not assessed**. |

## 8. Required next engineering actions

1. **P0-02:** remove rendered `message` and raw `lastError` from the delivery diagnostics projection; add a real-PG response sentinel test for both. Re-run notification authorization and projection tests.
2. **D-01/D-04:** obtain signed Product + Security decisions on global/assigned customer scope, per-action/access-type grants, exact categories and future taxonomy. If assignment-scoped, implement before calling compliance authorization accepted.
3. **Case-number oracle:** decide whether case numbers may be caller-selected/global. Prefer opaque server-generated values or an approved scoped uniqueness model and test collision behavior without cross-category/customer inference.
4. **Audit and Admin UX:** design a separately authorized subject/category-scoped audit surface and update compliance UI for any read-only grant; keep generic audit filtered.
5. **Regression:** rerun the focused P0 PG suites after remediation, then run the complete PG suite to completion with adequate time/resources and retain exact logs/aggregate; rerun backend unit and Admin Web suites on the same final SHA.
6. **Acceptance:** update this report with the remediation SHA, exact test evidence, resolved decision IDs and a new PASS/CONDITIONAL PASS/FAIL decision. Production approval remains a separate release/security process.

## 9. Boundaries observed

No production configuration, external SMS/email provider credentials, live financial transaction, production database or deployment was used. The temporary PostgreSQL instance was local, disposable and stopped after tests. Test fixtures used fake identities and committed placeholder credentials only.

## 10. Documentation commit / branch verification

This report is documentation-only under `docs/audit/20261028/sprint1-security-acceptance/`. It was committed and pushed as a fast-forward to the existing Arena 4 branch `arena/870f970d-monienaija`; the remote tip was verified equal to the documentation commit, with no other branch pushed or rewritten.

**Documentation commit SHA:** see the final delivery summary and the remote branch tip; the exact SHA is verified after push.
