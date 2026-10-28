# ARENA 1 — Customer compliance case authorization

- **Date:** 2026-10-28
- **Scope:** audit F-01 and the server-side category isolation in F-04
- **Integrated baseline:** `2fe5a2e9c882fe718370e582e13eb539cde8ca74`
- **Status:** backend mitigation implemented and locally verified; Product/Security decisions D-01 and D-04 remain open. This is not a deployment or a claim that a per-worker customer-assignment policy exists.

## Root cause and boundary

The 11 customer compliance case handlers used the generic customer route policy and delegated directly to the case service. Workforce authentication and the generic `SELF` rule did not establish a compliance function or a workforce-to-customer assignment. The service matched an existing case to its URL customer, but did not restrict workforce access by function or case category. The Admin screens filtered case categories in the browser, which was not an API security boundary. The general workforce principal carries a flattened function scope list, so it cannot distinguish role-function `VIEW` from `EXECUTE` by itself.

The case routes now require a validated workforce session and a dedicated, audited function decision by an `OPERATOR` or `PRIVILEGED` principal. The guard intersects the session's dynamically resolved scopes with active database role/function grants and their access types. Merely being workforce, privileged, or holding `kyc.view` is not enough. Customer self-service, agent, `SUPPORT`, and `SERVICE` principals are not permitted by this case API. Invalid/missing credentials are rejected; an authenticated but unentitled role/function is denied with 403.

### Enforced function and category mapping

| Existing function | Explicitly allowed case categories | Current seed examples |
|---|---|---|
| `compliance.manage_case` | `KYC`, `AML`, `SANCTIONS`, `PEP`, `DOCUMENT`, `ACCOUNT_REVIEW`, `MANUAL_REVIEW`, `OTHER` | `COMPLIANCE` and `SUPER_ADMIN` hold `EXECUTE` |
| `risk_fraud.manage_fraud_case` | `FRAUD` only | `RISK_FRAUD` holds `EXECUTE`; `SUPER_ADMIN` does not have this function in the seed |

These are function-based restrictions, not hardcoded role-name exceptions. A principal with **both separately active grants** gets the union; neither a broad administrative type nor a non-fraud grant silently includes fraud. Explicit category lists fail closed for future categories until reviewed. The fraud boundary implements the final V1 Product Owner Decisions 8 and 9 in `docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01.md`.

For each eligible case function, `VIEW` or `EXECUTE` may read, while only `EXECUTE` may mutate; `INITIATE` and `APPROVE` alone do neither. The global read-only-principal guard also continues to prohibit unsafe methods. There is **no new catalogue function or default read-only grant**: treating an explicitly assigned `VIEW` grant on these existing functions as read-only is an interim interpretation of the existing access type, subject to Product/Security review under D-01. Role assignments, active flags, and grant changes are rechecked on an existing session rather than trusting its issuance-time snapshot.

### Subject and case binding — important residual

Each list is restricted to the URL customer and the permitted category set. Detail and child operations require the **same customer ID, case ID, and allowed category**; comments, evidence, and assignments additionally query the child customer/case pair. For an existing customer, a wrong customer/case pair, inaccessible category, or nonexistent case receives the same 404. Creating an otherwise valid case in a disallowed category receives 403. Mutations lock the matching case row in their transaction; child reads take a shared row lock so a concurrent category change cannot disclose a previously visible child's data.

**This is not per-worker subject assignment.** Existing workforce principals have `customerAccess: NONE` and no approved customer-assignment relation for this API. A holder of an applicable function can therefore access that category for any valid customer ID; binding the URL customer to the case prevents cross-customer case substitution but does not restrict which customers the worker may search. Do not describe this as an approved assigned-customer policy or unqualified closure of D-01. Product and Security must decide whether a narrower subject/assignment model is required before claiming full subject authorization.

## API contract for Arena 2

All paths below are relative to `/api/v1`; `{customerId}` and `{caseId}` are UUIDs. The same class-level function guard covers every handler, including future handlers added to this controller. A GET requires the appropriate category's `VIEW` or `EXECUTE` grant; a POST/PATCH requires `EXECUTE`.

| Method | Path | Operation |
|---|---|---|
| POST | `/customers/{customerId}/compliance-cases` | Create in an authorized category |
| GET | `/customers/{customerId}/compliance-cases` | List only that customer's authorized categories |
| GET | `/customers/{customerId}/compliance-cases/{caseId}` | Read scoped detail |
| PATCH | `/customers/{customerId}/compliance-cases/{caseId}` | Update status/resolution/version |
| POST | `/customers/{customerId}/compliance-cases/{caseId}/comment` | Add comment |
| GET | `/customers/{customerId}/compliance-cases/{caseId}/comments` | List comments |
| POST | `/customers/{customerId}/compliance-cases/{caseId}/evidence` | Add evidence metadata/reference |
| GET | `/customers/{customerId}/compliance-cases/{caseId}/evidence` | List evidence |
| POST | `/customers/{customerId}/compliance-cases/{caseId}/assignment` | Assign |
| GET | `/customers/{customerId}/compliance-cases/{caseId}/assignments` | List assignments |
| GET | `/customers/{customerId}/compliance-cases/{caseId}/history` | List history |

The existing DTO fields `actor` and `uploadedBy` remain accepted and optional for wire compatibility, but are ignored for attribution. The validated workforce `principalId` is authoritative for case, child, history, and business-audit actors. Existing state transitions, optimistic version handling, and evidence metadata/reference formats are retained; this change does not provide an evidence-file storage/download API.

Arena 2 must handle 401/403 and scoped 404 responses without inferring that a hidden case exists, and must not use a browser filter or flattened session scope as the enforcement point. In particular, a flattened scope alone does not prove `EXECUTE`; action UI should handle a server 403 until an approved access-type-aware UI contract exists. The current Compliance and Risk/Fraud screens can continue client-side display filters, but the server now returns only the authorized category set. The visible Risk/Fraud warning that backend isolation is absent is now stale and should be revised by the Admin owner; `apps/admin-web` was intentionally not modified here. The current Admin case screen is lookup-oriented; these backend protections do not claim a completed case-management UI or browser acceptance (F-06).

The dashboard proxy endpoints `.../widgets/compliance-case-summary` and `.../widgets/fraud-case-summary` now recheck the same live function/access-type boundary. Non-fraud counts use the same explicit allowlist; fraud counts use only `FRAUD`. A dashboard's generic `audit-trail` widget follows the filtering described below.

## Audit integrity and alternate surfaces

* Create/update/comment/evidence/assignment business audit events and case history are written in the same transaction as the business change, with session-derived actors. A real-PostgreSQL failure-injection test verifies that an audit write failure rolls back the mutation and history.
* Function authorization decisions are recorded through the existing audited authorization service. A function-gate `ALLOWED` decision is **not** a final resource/category authorization: a later scoped lookup can still return 404. Missing credentials may be rejected before the function guard is reached.
* `AuditService.list()` filters by default. Generic `/internal/audit` and the dashboard `audit-trail` do not expose case, comment, evidence, assignment or history audit records; current case-function authorization decisions and legacy generic-customer route decisions containing `/compliance-cases` are excluded as well.
* A4/A7 `A4_POLICY_DECISION` facts can otherwise reveal a case through a customer ID and a `COMPLIANCE_...` reason, such as `COMPLIANCE_CASE_OPEN` or `COMPLIANCE_REVIEW_OPEN`. Generic audit views exclude those facts, including unknown future compliance-prefixed reasons and malformed reason-code shapes. Unrelated audit events and policy facts without restricted reasons remain visible.
* Filtering is performed before the list limit and does **not** delete or rewrite stored audit records. It currently hides restricted case-related records even from authorized compliance workers on these generic views; a category/subject-aware case-audit read API needs an approved policy. A trusted internal service may explicitly opt in; the maturity health consumer retains its previous all-events, limit-one **count only**, and no HTTP query parameter can enable this opt-in. Internal policy evaluation continues to read the complete customer case evidence set through a non-controller service method; it is not a case HTTP endpoint.
* The generic audit filter covers the known record types and policy-reason format above, not every conceivable external log or downstream projection. Operational request-log access/redaction and new downstream exports need separate security review.

## Decisions, dependencies and residual risks

1. **D-01 — Product + Security:** confirm the exact workforce roles/functions and per-subresource read/write entitlements, whether an independent read-only capability is needed, and whether workforce access requires customer/team/case assignment. Do not interpret the interim `VIEW` handling as a new approved grant.
2. **D-04 — Compliance Product + Security:** confirm the full category taxonomy and permitted non-fraud category mapping. The approved V1 fraud-only restriction is enforced; future categories are denied by default pending review. Any AML/SANCTIONS overlap requires an explicit additional function, not a silent broadening of the fraud function.
3. A caller-supplied case number remains globally unique. A 409 collision can reveal that a chosen number is already in use, including across categories/customers. Removing this residual requires an approved identifier/API policy; it was not changed here.
4. Generic audit consumers lose visibility of restricted case-related entries until an approved scoped audit surface exists. Stored records and the internal policy evidence path remain intact.
5. Admin integration and acceptance remain Arena 2 work: update the stale warning, verify list/empty/denial behavior, and decide whether a case workflow UI and access-type-aware presentation are needed. No Admin or mobile source was changed.
6. Notification-delivery authorization, limit diagnostics, other financial behavior, deployment, and production migrations were outside this assignment. No catalogue, funding controller, or product-catalogue file was changed.

## Verification

All tests below are local; no production service or database was contacted. The real-PostgreSQL harness used an isolated embedded PostgreSQL 18.4 server and per-run databases with the repository migrations and seed data. It fails rather than silently skipping when PostgreSQL is unavailable.

* `npm run build` — passed.
* `npx tsc --noEmit -p tsconfig.json` — passed.
* `npx jest --runInBand` — 202 suites / 2,026 tests passed.
* Targeted ESLint on the changed authorization, compliance, audit, maturity, dashboard controller/module, policy-reader and test files — passed, excluding the pre-existing dashboard widget data service errors noted below.
* `PG_TEST_RUN_ID=casefinal npx jest --config jest.integration.config.js --runInBand --runTestsByPath` with the nine paths below — 9 suites / 194 tests passed, including all 21 compliance HTTP/PG tests:
  * `test/customer-compliance-authorization.integration.spec.ts`
  * `test/v1-admin-configurable-dashboard-platform-01.integration.spec.ts`
  * `test/v1-admin-authorization-kyc-01.integration.spec.ts`
  * `test/v1-admin-authorization-foundation-01.integration.spec.ts`
  * `test/v1-admin-authorization-read-surface-01.integration.spec.ts`
  * `test/v1-harden-01-runtime-access-guard-boundary.integration.spec.ts`
  * `test/a22-admin-foundation.integration.spec.ts`
  * `test/v1-capability-registry.integration.spec.ts`
  * `test/v1-001-customer-funding.integration.spec.ts`

The new compliance integration suite covers all routes, both category directions, multiple grants, role/principal denial, customer/case mismatch, real sessions, grant revocation, `VIEW`/`EXECUTE`/`INITIATE`/`APPROVE`, spoofed actors, policy/audit and dashboard alternate views, concurrency, and transactional rollback. The wrong-type check also exercises the real guard and audited decisions with simulated `SERVICE`, `SUPPORT`, `CUSTOMER`, `AGENT`, and `AGGREGATOR` principals carrying an otherwise eligible function; A2 currently issues only `OPERATOR` or `PRIVILEGED` sessions. Unit tests exercise missing service contexts and the internal evidence path. One preliminary PG invocation used a run ID longer than the harness's 16-character limit and failed before database setup; it passed after the namespace was corrected.

`src/dashboard/dashboard-widget-data.service.ts` has six ESLint errors also present, with the same messages, at baseline `2fe5a2e...` (five `no-base-to-string`, one `no-unsafe-return`). They were not introduced or fixed by this change, and the whole changed-file lint set is therefore not claimed clean. `git diff --check` was clean.
