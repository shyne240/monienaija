# ADMIN WEB FALSE-COMPLETION AND NONFUNCTIONAL PAGE AUDIT

**Baseline:** `3428e37e02e7ea55b431f8d2d461fb2356a418de`  
**Admin Web source comparison:** ARENA 2 `3ace1511374ea250c9c14d86ceb957f2e5f51081`  
**Backend source comparisons:** baseline plus separate ARENA 1/3 trees; these commits were not merged or checked out.  
**Browser testing:** NOT EXECUTED. Source findings below are not claims that a request was reproduced in a browser or runtime.

## Severity-ranked findings

### F-01 — High / P1: Customer compliance endpoints have no dedicated compliance function gate

**Verified source facts:** `CustomerComplianceController` exposes customer compliance list/detail, update, comment, evidence, assignment and history methods without calling an authorization `requireFunction` check (`src/customer-compliance/customer-compliance.controller.ts:14-82`). Generic customer-route resolution allows `CUSTOMER`, `OPERATOR`, `SERVICE`, and `PRIVILEGED` principal types (`src/authorization/route-policy-registry.ts:220-233`). `AuthorizationService.checkCustomerScope` applies the customer-self comparison to customer principals; for non-customer workforce principals, `SELF` does not bind the URL customer ID to a workforce actor (`src/authorization/authorization.service.ts:244-276`). The global runtime guard is registered as `APP_GUARD` (`src/app.module.ts:230`), but the fallback policy does not require a compliance function.

**Impact:** A client-side menu/function check is not an API access boundary. Authenticated eligible workforce principals can reach sensitive compliance data/actions absent another route-specific constraint. The source establishes the missing gate; **no unauthorized request was sent** and no exploit is claimed.

**Admin Web relationship:** `ComplianceScreen.tsx` has UI permission checks and search/table behavior, but the case list/table path calls the controller above. The screen note acknowledges the controller’s missing category/function checks (`apps/admin-web/src/screens/authenticated/ComplianceScreen.tsx:157-176`).

**Evidence/test state:** source-confirmed; no endpoint runtime test executed. A3 authorization unit tests passed 16/16 collectively, but do not test this route. Recommendation: make endpoint authorization and customer scoping an explicit security acceptance item before any workflow-complete status.

### F-02 — High / P1: Fraud/compliance category “filtering” is browser-only

**Verified source facts:** `RiskFraudScreen` fetches the customer compliance-case list then filters to `FRAUD` in frontend state; its source comments say the controller has no category query and the returned list contains all categories (`apps/admin-web/src/screens/authenticated/RiskFraudScreen.tsx:18-45`). `ComplianceScreen` category selection changes `visibleCases` client-side (`apps/admin-web/src/screens/authenticated/ComplianceScreen.tsx:157-176`). Backend list handlers accept customer/case path parameters only (`src/customer-compliance/customer-compliance.controller.ts:14-82`).

**Impact:** This does not isolate data by case category, prevent direct API access, or establish compliance policy enforcement. A selected UI category must not be represented as backend filtering or fraud authorization.

**Classification:** the display filter is `FRONTEND_ONLY`; the overall fraud lookup is `PARTIAL`. It is not a mock endpoint, but it is a frontend-only policy-like filter. No runtime case list was fetched during this audit.

### F-03 — High / P1: Notification and limit-diagnostic UI scopes are not enforced as matching backend functions

**Verified source facts:** A2 `SystemHealthScreen` requires UI scopes including `notification.view_deliveries` and documents the missing server-side function check (`apps/admin-web/src/screens/authenticated/SystemHealthScreen.tsx:111,183-205`). Baseline `AdminNotificationController.listDeliveries` calls only `requireWorkforce` (`src/admin/admin-notification.controller.ts:30-42`); that helper rejects agent/customer/aggregator principals but accepts other authenticated workforce types (`:157-168`). A2 `LimitAssignmentScreen` similarly gates diagnostics on `limit.view` (`apps/admin-web/src/screens/authenticated/LimitAssignmentScreen.tsx:81-86,140-169`) and explicitly warns that the API checks workforce principal type rather than `limit.view` (`:332-335`). Baseline `GET /internal/limit-usages` and `GET /internal/limit-reservations` handlers call only `requireWorkforce` (`src/limit-catalog/limit-operations.controller.ts:43-59,76-95,148-160`), permitting OPERATOR/SERVICE/PRIVILEGED as stated in the controller comment (`:24-35`). The separate limit catalogue controller does call `requireFunction` for catalogue views/changes (`src/limit-catalog/limit-catalog.controller.ts:65-66,89-90,148-149,169-170,194-203`).

**Impact:** UI scope checks are not API restrictions. The limit diagnostic API's type-only policy may be intentionally sufficient, but the difference from UI `limit.view` must be explicitly authorized and tested. Manual reservation release is a separate privileged backend operation (`POST /internal/limit-reservation-recovery/release`, controller `:121-138`); the Admin screen explicitly says it offers no recovery mutation (`LimitAssignmentScreen.tsx:366-369`). No UI release action should be inferred from the read-only diagnostics panel.

**Evidence/test state:** no route-specific runtime authorization test was executed. Keep the limit catalogue's function-gated endpoints distinct from type-gated diagnostic endpoints.

### F-04 — High / P1: “Commercial rules” is a registry viewer, not a governed management workflow

**Verified source facts:** `CommercialRulesScreen` calls existing GET registry APIs, renders structured tables, exposes refresh, and explicitly says future governed configuration changes are separate (`apps/admin-web/src/screens/authenticated/CommercialRulesScreen.tsx:108-198`). It does not render create/edit/change-request/approval forms. Backend source contains governed write operations for fees (`src/fee-rules/fee-rule-registry.controller.ts:126-187`), commissions (`src/commission/commission-rule-registry.controller.ts:135-193`), rewards (`src/reward/reward-rule-registry.controller.ts:138-196`) and products (`src/product-catalog/product-catalog.controller.ts:122-180`); limits have create/modify controller operations (`src/limit-catalog/limit-catalog.controller.ts:36-126`).

**False-completion risk:** A visible registry and a populated row do not make fee/commission/reward/product/limit configuration editable, approved, persisted, reloaded or effective. These management capabilities are `BACKEND_ONLY`; the corresponding Admin screens are `PARTIAL` read-only registries. The matrix separates these rows rather than assigning `COMPLETE` based on screen labels.

**Evidence/test state:** A3 commercial-rule governance unit suite passed, but no PostgreSQL-backed change request/approval/read-after-write test ran. Fee calculation, product use, limit enforcement and reward crediting were not exercised.

### F-05 — High / P1: Reward-rule CRUD is not proof of reward accrual or credit effect

**Verified source facts:** The reward registry endpoints support governed record changes, but the route-policy source explicitly describes the current reward setup as lacking runtime reward-crediting behavior (`src/authorization/route-policy-registry.ts:809-825`; see also reward controller above).

**Impact:** A saved/visible rule is not evidence that customer/agent transactions accrue, reserve, post or reverse reward balances. Admin Web offers only a read-only registry tab (`CommercialRulesScreen.tsx:108-198`).

**Classification:** registry view `PARTIAL`; write workflow `BACKEND_ONLY`; end-to-end reward behavior remains **UNVERIFIED**. Do not close the gap with a UI-only “success” message.

### F-06 — High / P1: Compliance case operations are named as lookup, not full case management

**Verified source facts:** Admin Web exposes search and a table for cases; its case mode displays customer ID/category/status/reason (`ComplianceScreen.tsx:130-176`). Backend also has update, comment, evidence, assignment and history operations (`src/customer-compliance/customer-compliance.controller.ts:28-82`) with corresponding service calls.

**Impact:** The screen does not let a compliance operator complete the server-supported case lifecycle, and the case list does not query the additional subresources. A “Compliance Cases” menu entry must not be interpreted as assignment, evidence, comments, history or case-decision management.

**Scope note:** This is an incomplete Admin workflow, separate from F-01 authorization and F-02 client filtering.

### F-07 — High / P1: ARENA 2 agent-history UI and ARENA 3 API are separate source commits

**Verified source facts:** A2 Admin Web `AgentUnifiedHistoryPanel` calls `GET /internal/agents/:id/transactions` and builds pagination/type query parameters (`apps/admin-web/src/components/AgentUnifiedHistoryPanel.tsx:62-84`). The route is present in the separate A3 tree (`src/admin/admin-agent.controller.ts:132-150`) and delegates to `AgentTransactionHistoryService.listUnified`. The targeted A2 test source `apps/admin-web/__tests__/sprint3-admin-web-integration.test.tsx:10-18,554-735` passed 5/5, but its `ApiClient` is mocked and its “live” state is an in-memory mutable object.

**Impact:** Neither source commit alone proves a combined release has working UI-to-real-API behavior. A mocked green UI test cannot establish authentication, route reachability, real response mapping, persistence, or browser rendering.

**Evidence/test state:** A3 PostgreSQL integration source exists but the audit could not execute it: embedded `initdb` failed on missing `libpq.so.5`. A3 authorization/governance unit suites passed 16/16 but are not endpoint/persistence evidence. Capability status is `PARTIAL`; combined source/runtime/browser verification remains open.

### F-08 — Medium / P2: Workforce “enable” is omitted by policy, not a broken button

**Verified source facts:** A2 Workforce screen explicitly says it shows no enable action because the existing endpoint has no matching catalogue function (`apps/admin-web/src/screens/authenticated/WorkforceAdminScreen.tsx:173-179`). Baseline backend defines `POST /internal/admin/support/workforce-users/:id/enable` at `src/admin/admin-support-credentials.controller.ts:75-87`; its comment records that no enable/reactivate catalogue function exists, and the handler uses `requireOperational` type allowlisting rather than `requireFunction` (`:75-87,99-116`). Provision and disable use dedicated catalogue functions (`:44-72,90-97`).

**Impact:** The UI is intentionally incomplete at this policy boundary. Do not classify as accidental frontend omission, invent a permission, or infer that an endpoint being present makes the action safely available. Decide the permission/audit model first.

### F-09 — Medium / P2: “Privileged Approvals” is an ID lookup/decision form, not a pending queue

**Verified source facts:** `ApprovalsScreen` requires a known approval ID and then offers view/approve/reject actions (`apps/admin-web/src/screens/authenticated/ApprovalsScreen.tsx:57,127,184-191`). The audited generic privileged-approval controller exposes ID-based decisions, not a general list endpoint. A separate funding approval queue exists and should not be confused with this generic flow.

**Impact:** An admin with no approval identifier cannot use this page to discover pending work. The page is not a generic approval inbox; no assertion is made that it should become one without product requirements.

### F-10 — Medium / P2: Dashboard Settings supports assignment, not dashboard-template authoring

**Verified source facts:** The screen reads templates/widgets and presents role-to-template assignment controls; source has assignment controls and a save path (`apps/admin-web/src/screens/authenticated/DashboardSettingsScreen.tsx:60-62,100,149,204-253`). It lists template/widget details (`:185-199`). Backend exposes template reads (`src/dashboard/dashboard.controller.ts:27-33`) and role assignment APIs, but no template layout authoring action is rendered in this screen.

**Impact:** Role assignment is a real configuration action in source; template content authoring is not. Do not describe the page as full dashboard configuration.

### F-11 — Medium / P2: Agent class JSON configuration and network metadata are structured fields, not complete management workflows

**Verified source facts:** `AgentClassesScreen` serializes/parses selected object/config fields (`apps/admin-web/src/screens/authenticated/AgentClassesScreen.tsx:61,97`) and has create/edit submit plus refresh (`:189-206,237-313`). `AgentNetworkScreen` stringifies nested application metadata for display (`:908`).

**Impact:** These are not whole-page raw JSON endpoint explorers, and source has real structured flows. However, JSON fields require successful server validation/persistence and downstream behavior verification; none was performed. The matrix marks only the affected surfaces `YES — JSON field/form`, not a generic raw JSON viewer. No page presence or save toast is taken as proof of complete management.

### F-12 — Medium / P2: Agent class reassignment and PIN access are policy-blocked/unavailable

**Verified source facts:** the Admin agent network exposes an agent class assignment panel for permitted cases (`apps/admin-web/src/screens/authenticated/AgentNetworkScreen.tsx:1027-1038`); no post-activation class-reassignment endpoint was found in the audited route inventory. The Admin credential panel has no agent PIN read/reset action (`apps/admin-web/src/screens/authenticated/AgentCredentialPanel.tsx:58-134`); no Admin PIN inspect/reset route was found.

**Impact:** These are explicit policy/safety boundaries, not functionality that should be “fixed” by bypassing server checks or adding guessed APIs. Keep them `POLICY_BLOCKED` until product/security policy is approved.

### F-13 — Low / P3: Read-only observability pages contain fetch-only actions by design

Dashboard metrics, transaction observability, cash-to-cash operations, notification delivery, audit events, and commercial registries include GET/search/refresh interactions. Those pages can be useful and correctly read-only; they are not configuration, settlement, case-action, or policy-enforcement workflows. Transaction observability explicitly describes itself as read-only (`apps/admin-web/src/screens/authenticated/TransactionObservabilityScreen.tsx:179`). The audit does not label a fetch-only screen “nonfunctional” when its actual purpose is observability, but it must not be reported as a write/management capability.

### F-14 — High confidence limit: persistence and business effects have not been demonstrated

**Verified evidence:** no database-backed test completed and no real Admin browser journey ran. The A2 mocked test proves only that the component behaves against its mock; the A3 unit tests prove only their tested service-level assertions. No real API success followed by reload/read-after-write was observed for any Admin workflow.

**Impact:** Every matrix row therefore says `backend_persistence_verified = NOT TESTED`, `business_rule_enforcement_verified = NOT TESTED`, and `browser_interaction_verified = NOT TESTED`. This is deliberately stricter than inferring behavior from controller/service code or a test suite name.

## Explicit false-completion checks

- **Raw JSON pages:** no entire management page was counted complete merely for displaying JSON. Agent class configuration includes JSON-form fields; Agent Network displays nested metadata as JSON. These are recorded separately.
- **Generic endpoint explorers:** no route/endpoint presence or `ApiClient` call is counted as a user workflow by itself.
- **Fetch-only buttons:** read-only refresh/search flows are marked as observability or lookup; not configuration/settlement.
- **Placeholder/mock data:** no product screen was promoted to complete because of test fixtures. The only passing targeted Admin Web test is documented as a mocked transport/in-memory state test.
- **Success messages:** source-level success text is treated as confirmation that the HTTP call returned successfully, not independent persistence, reload or operational-effect proof.
- **Disabled/nonfunctional actions:** workforce enable is intentionally omitted at a permission boundary; class reassignment/PIN actions are unavailable or policy-blocked. They are not silently reclassified as implemented.
- **Source-only claims:** all runtime authorization, persistence, browser interaction and downstream business effects remain unverified where explicitly marked.

## Recommended review sequence

1. Resolve F-01 through F-03 in backend authorization policy and route tests before treating UI guards as security controls.
2. Agree on configuration approval/audit/effect criteria; implement and test read-after-write plus downstream business effects for F-04/F-05.
3. Complete an approved A2+A3 source integration, then run real DB-backed API tests and a browser journey for F-07.
4. Decide product scope for F-06, F-08, F-09 and F-10. Do not assume every missing action is approved policy.
5. Keep F-12 blocked until security/policy explicitly authorizes it; never weaken financial controls to make the UI appear complete.