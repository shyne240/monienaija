# Independent security acceptance review — controlled integration `bc9fadf`

**Review date:** 2026-10-30  
**Target branch:** `integration/main-backend-frontend-20261030`  
**Pinned target:** `bc9fadf54466d274218129261d66c17d9387e3c5`  
**Integration report reviewed:** `docs/integration/20261030-CONTROLLED-INTEGRATION-REPORT.md`  
**Reviewer disposition:** **FAIL — not ready for final acceptance**

This is a documentation-only independent review of the pinned integration tree. No application code, test, production data, provider, or deployment was changed. The Report 30 compliance-assignment architecture was not implemented or relied on.

## Executive decision

The integration has meaningful hardening worth retaining: the workforce mock-token and mock-subject bypasses are retired; workforce sessions derive roles from active assignments and the catalogue; customer transfers pass a session-derived `CUSTOMER_SELF` source-wallet binding into the transfer service; the generic customer financial command routes remain disabled; and the merged source compiles. Those points do not make this tree acceptable as-is.

Two authorization defects block acceptance:

1. **High — internal operational routes are authorized by principal type, not by a granular capability.** The generic `/api/v1/internal/*` policy allows every valid `SUPPORT`, `OPERATOR`, `SERVICE`, and `PRIVILEGED` principal without a required function/scope. In particular, the production readiness/deployment/configuration handlers have no controller-level capability check. The readiness response includes migration metadata, database/reconciliation state and pending outbox count. This replaces main’s `internal:access` gate with a broad workforce-session gate, contrary to least privilege.
2. **Medium — `/api/v1/internal/version` is explicitly public.** It returns only API-version metadata and a timestamp, so the direct disclosure is limited, but it contradicts the source comment that version is non-public and main’s workforce-only contract. The independent HTTP test confirmed anonymous access (200).

The 17 failed assertions are **not all obsolete expectations**, as the integration report claims. Several customer-route assertions are stale against the selected `/customers/me/*` product boundary, and a 401-vs-403 assertion is only a status-code mismatch. But the current suite also demonstrates the public internal-version route and the absence of granular internal authorization. Reclassifying all 17 as harmless policy conflicts would hide real gaps.

The customer mobile FundWallet and Withdraw screens can remain unregistered **only as a temporary containment choice pending the mobile owner’s review**. They are nonfunctional in that state; the current integration cannot be treated as final app acceptance until the owner either re-points them to supported `/customers/me/*` APIs and tests them, or explicitly removes/defers those product surfaces.

**May integration proceed toward final acceptance? No.** It may proceed as a review/fix candidate, but final acceptance requires the fixes below, a replacement authorization matrix aligned to the chosen API, security tests proving both denial and authorized least-privilege access, mobile-owner disposition, and a rerun of the relevant full suites. No merge to main or deployment is authorized by this review.

## Scope and independent verification

The review inspected the exact pinned commit and the integration report, reconstructed the reported 27 conflict paths from the merge-base evidence and final merge resolution, and reviewed all 27 resolution outcomes. Focus was on authorization/authentication, configuration, financial endpoints, mobile registration, and the report’s test modifications. Particular source paths include:

- `src/authorization/route-policy-registry.ts`, `runtime-access.guard.ts`, `workforce-session.service.ts`, `workforce-oidc.service.ts`, and `workforce-administration.controller.ts`;
- `src/config/environment.ts`, `src/production/production.controller.ts`, `production-readiness.service.ts`, and `production-configuration.service.ts`;
- all five conflict-resolved financial controllers and the customer transfer handler/service ownership binding;
- customer mobile navigation, screens, API configuration, and transfer/auth-store tests.

### The 27 conflict resolutions reviewed

| Group | Resolved paths | Independent disposition |
|---|---|---|
| Repository/configuration/docs (3) | `.env.example`, `.gitignore`, `README.md` | Environment-key union is directionally correct; documentation still needs to stop describing retired mock-sandbox credentials as usable. No acceptance blocker identified in these three resolutions. |
| Admin Web (4) | `apps/admin-web/src/config/index.ts`, `src/services/api-client.ts`, `src/store/auth-store.ts`, `vite.config.ts` | Reviewed against the integration report and written owner preparation. Fail-closed build configuration and request-only guard are preserved with the proof-of-address client methods and dev proxy. No independent backend authorization defect identified here; Admin Web owner ratification and browser/accessibility testing remain outstanding, not established by this review. |
| Customer mobile (5) | `apps/customer-mobile/__tests__/auth-store.test.ts`, `__tests__/transfer.test.tsx`, `src/config/index.ts`, `src/screens/unauthenticated/LoginScreen.tsx`, `src/store/auth-store.ts` | These are the mobile transfer/config/login/auth-store conflicts plus the auth-store test. Navigation types were also inspected because FundWallet/Withdraw route keys were restored without registering the screens. The chosen non-registration is a reasonable fail-closed interim measure, not a completed product resolution. Owner review is required before final acceptance. |
| Manifests (2) | `package.json`, `package-lock.json` | Dependencies install using `npm ci --ignore-scripts --no-audit --no-fund` (982 packages). No manifest-integrity issue was observed in this review. |
| Authorization/workforce (5) | `src/authorization/route-policy-registry.ts`, `runtime-access.guard.ts`, `workforce-administration.controller.ts`, `workforce-oidc.service.ts`, `workforce-session.service.ts` | Mock bypass retirement and catalogue-backed active-role resolution are positive. The registry’s public version exception and catch-all workforce policy are blockers (findings H-01 and M-01). |
| Platform configuration (1) | `src/config/environment.ts` | Inspected for preservation of main’s production safeguards and the lineage’s config constraints; no bypass restoration was found. |
| Financial controllers (5) | `src/deposit/deposit.controller.ts`, `src/transfer/transfer.controller.ts`, `src/transfer/wallet-transaction.controller.ts`, `src/wallet/wallet.controller.ts`, `src/withdrawal/withdrawal.controller.ts` | They retain the lineage’s workforce-oriented reads and disabled generic customer command endpoints. This aligns with the requested dedicated `/customers/me/*` model; customer access must not be re-enabled by merely changing registry entries. The customer transfer route’s separate ownership binding was independently traced below. |
| Backend tests (2) | `test/external-reconciliation.service.spec.ts`, `test/production-readiness.spec.ts` | The migration-head derivation is preferable to a stale hardcoded test expectation; no assertion relaxation was detected in the inspected changes. |

The integration’s separate customer transfer handler change is also security-sensitive: `POST /customers/me/transfers` derives `CUSTOMER_SELF` from the authenticated customer and the service checks ownership on both a new transfer and an idempotency replay. The request cannot supply this binding. The destination-wallet rule remains intentionally broader than source ownership. This is a positive control; it does not validate every other service call site or substitute for end-to-end adversarial tests.

## Findings

### H-01 — generic internal route policy grants broad workforce reach without capability checks

**Severity:** High  
**Evidence:** In `RoutePolicyRegistry.resolve()`, the catch-all for `/api/v1/internal/*` returns `WORKFORCE_SESSION` with `allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED']` and no `requiredFunctions` or `requiredScopes`. `RuntimeAccessGuard` authorizes the declared policy, so a valid workforce principal with any recognized active role satisfies this generic gate. Some `OperationsController` methods add `requireFunction()` (metrics/diagnostics/outbox), but `ProductionController` does not: `configuration`, `deployment`, and `readiness` simply return the service result. `ProductionReadinessService.getReadiness()` returns database/migration/reconciliation state, migration name/timestamp/count, pending outbox count, version, and checked time. It also executes reconciliation while servicing readiness.

**Why this is not merely the 17-test policy disagreement:** the report acknowledges main’s operational routes required `internal:access`, which the lineage says no role receives. Replacing that dead scope with “any authenticated workforce category” restores reachability but does not establish a least-privilege replacement. A valid workforce session is authentication, not authorization to inspect deployment and reconciliation internals. Controller-level gates are inconsistent across the internal surface, and a type allowlist cannot distinguish a narrow read-only/support role from an authorized operations role.

**Required fix:** Authorization/Security owner (Arena 3) must define explicit catalogue function requirements or an equivalently narrow role policy for every internal operational/readiness/configuration route. Apply those checks consistently at the guard or controller boundary; preserve service-to-service/health needs without exposing operational details to every workforce role. Add real-HTTP negative tests for a valid but unassigned/low-privilege role and positive tests for the approved function-bearing role. Replace the old `internal:access` test fixture with catalogue-backed principals; do not weaken the tests to make the current broad policy pass. Separately ensure readiness GET does not perform financial/operational reconciliation side effects unless this is intentional, independently authorized, and idempotently safe.

### M-01 — internal version endpoint is public despite the internal route contract

**Severity:** Medium (limited payload; authorization inconsistency)  
**Evidence:** `GET /api/v1/internal/version` is listed in `PUBLIC_ROUTES`, before the generic internal route branch. I reran the HTTP matrix: the anonymous request returned 200. The handler returns current/supported API version, header name, and discovery timestamp. The adjacent source comment says internal version is non-public; the main-side contract and HTTP tests expect authentication, and the customer-token request also receives 200.

**Required fix:** Authorization/Security owner: remove this exact route from `PUBLIC_ROUTES` and route it through the intended workforce policy, or document/approve a deliberate public version endpoint under a public URL and make the `/internal` path non-public. Add tests asserting both anonymous and customer denial on the internal path. Do not treat a generic version-disclosure exception as evidence that other internal routes are safe.

### OI-01 — FundWallet/Withdraw are safely dark but not accepted functionality

`FundWalletScreen.tsx` and `WithdrawScreen.tsx` remain unregistered while their callers still target generic workforce-only APIs. Keeping them dark is safer than registering broken/unauthorized customer surfaces. **They may stay unregistered pending owner review**, but the mobile owner must record a disposition before final acceptance: re-point to customer-owned supported routes and prove the UI/API contract, or explicitly defer/remove the feature. The mobile owner must also ratify the config/auth-store/login/test merge decisions. Do not re-enable generic financial commands to make the screens work without Product and Security approval.

## Disposition of all 17 failing assertions

I independently ran the exact focused suites after installing dependencies. Results: **2 suites failed, 17 assertions failed, 46 passed**. The matrix suite’s failure details and current behavior follow.

| # | Failing assertion | Independent disposition |
|---:|---|---|
| 1 | Anonymous `GET /api/v1/internal/version` expected 401, got 200 | **Real policy defect / M-01**, not obsolete. |
| 2 | Customer deposit create on generic `POST /deposits` expected 201 | **Obsolete against the selected product boundary**: generic customer commands are deliberately disabled; replace coverage with the supported `/customers/me/*` contract, not a policy bypass. |
| 3 | Spoofed customer ID on generic deposit expected 400, got 403 | **Stale route expectation**; 403 is safe denial for the disabled generic command. Add equivalent spoofing coverage to the supported customer endpoint if applicable. |
| 4 | Customer transfer via generic `POST /transfers` expected 201 | **Obsolete route expectation**; generic command remains disabled. Test `/customers/me/transfers` and source ownership instead. |
| 5 | Customer wallet collection listing expected 200 | **Obsolete route expectation**; use customer-owned `/customers/me/*` reads. |
| 6 | Customer deposit-by-ID ownership-checked read expected 200 | **Obsolete route expectation**; no generic customer read contract was selected. |
| 7 | Customer withdrawal generic create expected 201 | **Obsolete route expectation**; generic customer commands remain disabled. |
| 8 | Customer denied on `/internal/version` expected 403, got 200 | **Real policy defect / M-01**, same root as #1. |
| 9 | Workforce token on customer `/wallets` expected 401, got 403 | **Not an authorization bypass.** The principal is recognized but disallowed by route policy, so 403 is the correct authorization result; update the status assertion and retain the denial assertion. |
| 10 | Workforce with `internal:access` expected to read diagnostics | **Stale test contract/fixture**, but it exposed the broader H-01 issue. Re-test with the approved catalogue function, not an undocumented legacy scope. |
| 11 | Workforce with `internal:access` expected to read metrics | **Stale test contract/fixture**, with the same H-01 gap. Controller currently has a function check; test using the actual function-bearing role. |
| 12 | Workforce with `internal:access` expected to read outbox | **Stale test contract/fixture**, with the same H-01 gap. Controller currently has a function check; test using the actual function-bearing role. |
| 13 | Workforce lacking `internal:access` expected denied on `/internal/readiness`, got 200 | **Real least-privilege defect / H-01.** The route has no replacement function/scope check and returns internal operational metadata. |
| 14 | Anonymous `POST /customers` registration expected 201, got 401 | **Obsolete endpoint contract** against the selected lineage’s OTP + `/customers/registration` lifecycle. Test the current registration endpoints and their abuse controls. |
| 15 | Registry expected `/customers` public | **Obsolete endpoint contract** for the same reason as #14; anonymous registration is on the dedicated registration routes. |
| 16 | Registry expected operational routes to require `internal:access` | **Stale scope expectation**, not a safe current result. The replacement must be explicit function/role policy; see H-01. |
| 17 | Registry expected customers on generic financial routes | **Obsolete against the requested `/customers/me/*` model**; retain the denial of customers on generic financial commands and test their supported dedicated routes. |

Thus the report’s “all failures are D-01/no defect” conclusion is rejected. Of the 17, nine are stale product-route expectations (#2–7, #14–15, #17); one is a correct 403-vs-401 denial whose expected status should change (#9); three use the stale `internal:access` fixture (#10–12); two repeat the public-version defect (#1, #8); and the remaining two (#13, #16) expose the lack of a least-privilege replacement for the legacy internal scope. These dispositions do not authorize removing security assertions; replacement tests must be approved and cover the chosen implementation.

## Test and evidence record

| Check | Independent result |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` in isolated pinned worktree | PASS; 982 packages installed. No application files changed. |
| `npx tsc --noEmit -p tsconfig.json` | PASS; 0 errors. |
| `npx jest --runInBand test/authorization-http-matrix.spec.ts test/runtime-access.guard.spec.ts` | FAIL; 2 suites, 17 failed / 46 passed. Confirmed the public version endpoint and readiness no-scope behavior described above. |
| PostgreSQL suites / full suite | Not rerun in this independent pass. The integration report’s claimed results remain claims, not independently reproduced here. |

A first invocation through `npm test -- --runInBand` was rejected because the package script already supplies `--maxWorkers=2`; it did not run tests. The corrected direct `npx jest --runInBand ...` invocation above is the actual result. The isolated review worktree remains pinned at the requested commit and no source/test modifications were made.

## Exact acceptance gates and responsible owners

1. **Authorization/Security owner (Arena 3):** close H-01 and M-01 with explicit per-route policies; add real HTTP allow/deny tests against catalogue-derived principals, including SUPPORT and low-privilege/read-only roles; retain non-customer denial on generic financial endpoints.
2. **Product Owner + Backend API owner:** ratify the `/customers/me/*` financial API and OTP registration contract represented by the integration; declare the corresponding main-side generic-route and `POST /customers` test expectations superseded, then replace—not delete—them with coverage of the accepted contract.
3. **Mobile owner:** formally disposition FundWallet/Withdraw and ratify all mobile merge resolutions. Until then, keep those screens unregistered; do not claim mobile financial-flow acceptance.
4. **Integration / Backend owners:** rerun focused authorization tests, backend unit/component suites, migration/PG suites, and mobile suites from the final candidate SHA. Resolve every remaining red assertion rather than carrying known failures into final acceptance.
5. **Independent acceptance:** request a fresh review of the fixed candidate. This report does not authorize merge, deployment, provider activation, production data changes, or Report 30 enforcement architecture.

## Verdict

**FAIL.** Compilation and selected hardening are positive, but the integrated authorization contract is not safe to accept while internal routes lack least-privilege function gates and `/internal/version` is public contrary to its internal contract. The 17 red assertions need individually correct disposition; they cannot be waived as one product disagreement. The branch may continue through remediation and owner review, but **may not proceed to final acceptance** until the gates above are complete.
