# MonieNaija backend API and Admin Web discovery audit

**Audit date:** 2026-10-27  
**Scope:** read-only source discovery against baseline `3428e37e02e7ea55b431f8d2d461fb2356a418de`, with separate source inspection of ARENA 1–4 commits.  
**Conclusion:** **no capability is classified COMPLETE.** Source presence and test-source assertions are not proof of an operational browser workflow, persisted state, or business-rule effect. No application source, test, migration, or configuration was changed by this audit.

## Deliverables

- `admin-web-capability-matrix.csv` — 38 audited Admin Web or adjacent workflow capabilities; includes actual actions, UI/API evidence, JSON/mock flags, persistence/business-rule/browser verification fields, status, priority, and review order.
- `backend-api-endpoint-inventory.csv` — 460 controller operations with verb/path, controller handler, request decorators/DTO hints, return expression, authorization notes, source references, module class/file, and static Admin/test references. The static matcher fields are explicitly named as unverified hints.
- `backend-component-inventory.csv` — 85 Nest module, 82 controller, and 176 service entries, with statically scanned declarations and controller-use/service-reference hints.
- `backend-service-capability-inventory.csv` — all 176 backend services, statically scanned public method names/line references, module-directory hints, direct controller-reference hints, and 82 “service-only” candidates. These candidates may be used transitively and are not assumed unreachable.
- `admin-web-api-call-inventory.csv` — source-scanned Admin Web API call expressions and file/line locations. This is not a workflow-completeness report.
- `ADMIN-WEB-FALSE-COMPLETION-AUDIT.md` — severity-ranked false-completion, misleading-scope, authorization, and verification findings.

## Source comparison and method

The four requested source commits were inspected as isolated source trees; none was merged, checked out on the working branch, or altered:

| Source | Commit | Inspection use |
|---|---|---|
| Baseline | `3428e37e02e7ea55b431f8d2d461fb2356a418de` | Backend/API and Admin Web baseline |
| ARENA 1 | `d0d8f6c61a2d243dda69e45c342195ae4526c098` | Cash-to-cash locator redemption/recovery addition |
| ARENA 2 | `3ace1511374ea250c9c14d86ceb957f2e5f51081` | Admin Web changes and targeted mocked test |
| ARENA 3 | `bad1b9b2b521af96644329a73491f32c8b50680b` | Workforce agent-history endpoint, authorization and tests |
| ARENA 4 | `270cf8fa50b9f12c5c82610e6b531faa7d9c63ba4` | Documentation-only source comparison; no implementation delta treated as proof |

Counts were produced by static scans over Nest route decorators, source declarations and Admin Web API calls, then selectively source-traced. Baseline/A4: 457 route operations; A1: 459; A2: 457; A3: 458. The aggregate union of baseline plus independent A1/A3 additions is 460 operations: GET 225, POST 193, PATCH 36, DELETE 5, PUT 1. The union is a comparison set, **not a tested or merged build**. The counts can miss dynamically registered routes and do not establish runtime reachability. Baseline `src/main.ts:44-52` applies the `/api/v1` prefix, global `ValidationPipe` with `transform`, `whitelist`, and `forbidNonWhitelisted`, plus the global exception filter; `src/app.module.ts:230` registers `RuntimeAccessGuard` as `APP_GUARD`. These global mechanisms do not replace route-specific function/resource authorization.

Backend source inventory counts: 85 module files, 82 controller files, 176 service files and 131 DTO files. Eighty-two services are static *no direct controller-name reference* candidates, not a definitive list of unreachable functionality: several are invoked by other services, jobs, handlers, seeds or event consumers. The inventory preserves those as candidates and shows discovered references rather than claiming they are unused. Admin Web has 27 menu view keys in `apps/admin-web/src/screens/authenticated/Layout.tsx:55-123`; the A2 snapshot contains 34 files under `src/screens` (31 TSX, two TS and one stylesheet). Menu entries are not a count of complete workflows.

The API CSV's request DTO, response expression, `effective_auth_context`, and test-reference fields point to source evidence. Where handlers delegate to services or leave return types inferred, the inventory says so instead of inventing a response schema. Static test/path matching is only a lead; “no match found” does not mean no test exists. The Admin Web call-site scan recorded 130 endpoint expressions. Similarly, 75 static route rows had an Admin Web consumer match and 385 did not; neither total determines coverage or functionality.

## Executive findings

1. **Security/policy:** customer compliance-case controller operations lack a dedicated compliance function check. Generic `/customers/:id/...` route policy permits authenticated `OPERATOR`, `SERVICE`, and `PRIVILEGED` principals, while the controller does not call `requireFunction`; workforce `customerAccess: SELF` is not a customer-ID restriction for those non-customer principals. Evidence: baseline `src/customer-compliance/customer-compliance.controller.ts:14-82`, `src/authorization/route-policy-registry.ts:220-233`, `src/authorization/authorization.service.ts:244-276`. This is source-confirmed, **not runtime-exploited or runtime-tested**.
2. **Client-side isolation only:** the Risk/Fraud and compliance views fetch the customer case list and filter categories in React. The backend list does not accept a category filter or enforce a function gate; the UI itself documents this. Evidence: A2 `apps/admin-web/src/screens/authenticated/RiskFraudScreen.tsx:18-45`, `ComplianceScreen.tsx:157-176`; baseline controller above.
3. **Configuration pages are not management workflows:** Commercial Rules renders structured registry tables and refreshes GET endpoints. Backend fee, commission, reward and product registries have governed write routes, and the limit catalogue has create/modify routes, but these screens do not provide the corresponding create/edit/approval/reload/effect journey. Evidence: A2 `CommercialRulesScreen.tsx:108-198`; baseline fee/commission/reward/product/limit controllers cited per row in the matrix.
4. **Other incomplete flows:** compliance cases are lookup-only despite backend comment/evidence/assignment/history/update operations; the generic privileged-approval page requires a known approval ID and is not a queue; workforce enable is deliberately omitted because the existing endpoint lacks a matching catalogue function; reward configuration does not prove runtime reward crediting.
5. **Cross-commit integration:** A2 Admin Web agent history calls `GET /internal/agents/:id/transactions`; that endpoint exists in the separate A3 source commit. A2’s targeted five-test suite mocks `ApiClient` and mutates in-memory test state. It is not real HTTP, persistence or combined A2+A3 evidence.

## Sprint-source contracts and effects

- **ARENA 1 cash-to-cash locator operations:** `POST /api/v1/agents/cash-to-cash/claim-by-number` and `POST /api/v1/agents/cash-to-cash/claims/recover-by-number`, both HTTP 200 on success, are declared at `src/agent/agent-cash-to-cash-claim.controller.ts:49-59`. Both require an authenticated `AGENT` principal whose `agentId` matches `principalId` (`:67-78`). DTOs require sender phone length 1–20, a six-digit number, and—in claim—existing claim credentials/identity, OTP and idempotency fields; `transferId` is forbidden (`src/agent/dto/cash-to-cash-claim.dto.ts:9-105`). Global validation is `transform + whitelist + forbidNonWhitelisted` (`src/main.ts:44-52`). Claim resolves a protected locator then delegates to the canonical claim/settlement path; unknown/invalid locator cases are normalized and retry/recovery errors are explicit (`src/agent/agent-cash-to-cash-claim.service.ts:98-139`). The canonical path includes serializable settlement, idempotency, ledger posting, limit work and transfer-state mutation (see `:463-535,713-840`), so it is a financial write. Recovery resolves the locator and replays the receipt only if the idempotency key matches; it does not invoke a second settlement (`:122-135`). The migration `src/migrations/1785753600096-CreateCashToCashLocators.ts` is source evidence of schema intent, not proof that it was applied. ARENA 1 has integration/contract test sources (`test/a16-agent-cash-to-cash-claim.integration.spec.ts`, `test/cash-to-cash-locator-contract.spec.ts`); neither was executed in this audit. These Agent APIs do not constitute an Admin Web workflow.
- **ARENA 3 agent-history API and authorization changes:** `GET /api/v1/internal/agents/:id/transactions` is source-declared at `src/admin/admin-agent.controller.ts:129-150`. It requires a workforce principal plus `agent.view`, validates the agent UUID, returns 404 for unknown agent, and delegates paging/type validation to the history service. The documented response is `{ items, pagination }`; item projection, six canonical types, filtering and database read queries are in `src/agent/agent-transaction-history.service.ts:55-79,77-95,294-380`. Its PostgreSQL HTTP test source exercises valid projection, type filtering, pagination and authorization (`test/v1-sprint3-agent-history-workforce.integration.spec.ts:281-473`), but that DB-backed test did not complete in this environment. ARENA 3 also modifies declared-gate enforcement in `src/authorization/runtime-access.guard.ts:171-196` and adds `limit.view`/`limit.modify` checks to limit-assignment routes (`src/limit-catalog/limit-assignment.controller.ts:41,72-157,179-223`). The distinct limit diagnostics controller still uses workforce-principal-type gates only (`src/limit-catalog/limit-operations.controller.ts:43-59,76-95,148-160`). A2's panel uses a real `ApiClient` call in product source; its targeted test uses a mocked client (`apps/admin-web/__tests__/sprint3-admin-web-integration.test.tsx:10-18,554-735`). Because A2 and A3 are separate commits, the API/UI pairing is not treated as an integrated release.

## Verification performed and limits

- **A2 Admin Web targeted test:** 1 suite, 5/5 tests passed in an isolated A2 snapshot (`apps/admin-web/__tests__/sprint3-admin-web-integration.test.tsx`). Its `ApiClient` is mocked and the “live” state is a local mutable object; no real API or database was involved.
- **A3 unit tests:** 2 suites, 16/16 tests passed (`authorization.service.spec.ts` and `commercial-rule-governance.service.spec.ts`) in an isolated A3 snapshot. Unit tests do not establish endpoint runtime, database persistence or full approval workflow behavior.
- **A3 PostgreSQL integration test:** not run to completion. The isolated embedded PostgreSQL startup failed because `initdb` could not load `libpq.so.5`; the targeted A3 DB-backed test therefore has no pass result.
- **Browser/device journey:** **NOT EXECUTED.** No user-facing browser journey is claimed.
- **Persistence/business effect:** **NOT TESTED** for all matrix rows. Code may call persistence or a governed service; this is not a live read-after-write or downstream operational-effect check.
- **No COMPLETE:** the acceptance standard requires source-traced UI/API/controller/service and authorization plus verified actions, persistence/effect and relevant tests. Critical browser/persistence evidence is absent; therefore no row qualifies as COMPLETE.

## Configuration inspection standard applied

For each visible configuration or admin workflow, the matrix records whether source exposes view/read, create/edit/assignment, validation, API submit, success/error handling, reload/read-after-write, authorization/audit and an operational effect. Source evidence of a handler or API request is not converted into runtime proof. `backend_persistence_verified`, `business_rule_enforcement_verified`, and `browser_interaction_verified` are `NOT TESTED` throughout because no real database-backed browser workflow was executed. The JSON flag distinguishes JSON-form fields/metadata from an entire raw JSON viewer. No generic raw endpoint explorer was counted as management.

## Review order

1. **P1 security and authorization:** F-01 compliance route gate and caller/subject scoping; F-02 category isolation; F-03 notification-delivery and limit-diagnostic function-level authorization.
2. **P1 financial/configuration integrity:** F-06 governed commercial/product/limit workflows; confirm approvals, persistence, audit, reload and actual runtime effect before any “complete” claim. Keep reward-engine effect distinct from reward-rule CRUD.
3. **P1 integration and operational evidence:** F-10 A2/A3 agent-history integration; execute database-backed API and browser tests after source integration is approved.
4. **P2 workflow gaps:** compliance case actions, generic approvals queue (if required), workforce enable policy, dashboard template authoring, explicitly policy-blocked agent actions.
5. **P3 usability and evidence:** inspect JSON config fields, document read-only observability pages, and add repeatable browser/read-after-write test evidence.

## Workspace preservation

The current branch remains `arena/870f970d-monienaija`. The checkout was dirty before audit; its existing changes were not reset, staged, committed or pushed. `npm ci` created ignored `node_modules` in the repository; it did not modify tracked source. Audit outputs are documentation-only additions under this directory. No branch switching, merge, migration, deployment or financial-control change was performed.