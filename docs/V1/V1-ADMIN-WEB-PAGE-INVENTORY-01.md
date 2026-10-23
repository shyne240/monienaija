# V1 Admin Web — Page, Route, Role, API & Action Inventory

**Prepared:** 2026-10-23  
**Repository:** `shyne240/monienaija`  
**Branch:** `arena/edba26d6-monienaija`  
**Code baseline reviewed:** `1ddfe3181cba6c725c33cf6d106f1f4d655453ac` plus the pre-existing, unrelated dirty worktree noted below.  
**Purpose:** establish the current route/action inventory before bounded Admin Web completion work; track API evidence, UI availability, and actual-interface/E2E evidence separately.

> This is a code-inspection inventory, not a claim that the backend was deployed or exercised. No authenticated HTTP requests, database-backed API calls, browser walkthrough, or E2E session were performed for this inventory. Controller-path verification is static only. Frontend scope checks control presentation/navigation; they do not replace backend authorization.

## 1. Scope, evidence, and integrity

- The route tree in `apps/admin-web/src/screens/authenticated/Layout.tsx` is the current menu authority: **25 sidebar destinations in seven sections**. Older untracked reports in `docs/V1/MENU-VERIFICATION-ALL-11-ROLES.md` and `docs/V1/END-TO-END-FUNCTIONALITY-AUDIT.md` describe an earlier menu that included C2C; that is not the current sidebar. C2C remains a transaction type in customer-scoped history, not a global admin route.
- The 11-role menu fixture is `apps/admin-web/__tests__/menu-visibility-11-roles.test.tsx`; `navigation-access.ts` is the frontend route guard. The names below describe frontend visibility and UI affordances, not the backend's final authorization decision.
- Each page's API status distinguishes **static route/controller evidence** from **runtime verification**. A listed controller path is not a tested API response. The actual interface/E2E column remains “Not performed” unless explicitly changed in a later batch entry.
- At inventory start, the worktree already contained unrelated modifications and untracked files, including V1 docs, backend authorization/Agent-funding work, tests, readiness code, and a migration. They are preserved. This UI batch does not stage or include them. Where a source file was dirty, this inventory reports what was visible in the worktree and does not represent that dirty code as committed or validated.
- Scope references: `V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01.md`, `V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md`, `ADMIN-INFORMATION-ARCHITECTURE-PROPOSAL.md`, and `V1-ADMIN-AUTHORIZATION-AND-PORTAL-DECISION-01.md`. Do not use the historical proposal's older C2C menu as route truth.

### Evidence labels

- **API static:** controller/route and current screen call were source-inspected; no HTTP request was made.
- **UI available:** visible screen and its implemented controls were source-inspected; this does not mean browser E2E was performed.
- **UI test:** an automated React/Jest test may exercise a rendered component and mocked `ApiClient`; this is not an actual backend or authenticated end-to-end verification.
- **E2E:** browser-driven interaction against a running Admin Web and backend. **Not performed for any page in this inventory.**

## 2. Role × visible route matrix

Route keys are the exact current `AdminView` keys. Counts include the always-visible Operational Dashboard. There are 25 visible destinations; C2C is not one of them. “Contextual” indicates a route/function reachable from Customer 360° rather than a menu item.

| Role | Visible sidebar destinations (count) | Important contextual actions / limits |
|---|---|---|
| `SUPER_ADMIN` | `dashboard`, `dashboardSettings`, `customers`, `agents`, `support`, `transfers`, `cashIn`, `cashOut`, `ledgerExplorer`, `reconciliation`, `feeRules`, `commissionRules`, `rewardRules`, `productCatalogue`, `limitCatalogue`, `limitAssignments`, `kycQueue`, `complianceCases`, `workforceAccess`, `roleGovernance`, `systemHealth`, `auditEvents` (22) | Customer 360° links include transaction history, KYC, compliance, support, audit, and limits where the relevant function is present. Has no `fraudCases`, `approvalsInbox`, or recovery menu route. Role-governance UI currently handles Finance-role forms only. |
| `FINANCE_PREPARER` | `dashboard`, `ledgerExplorer`, `feeRules`, `commissionRules`, `rewardRules`, `productCatalogue`, `limitCatalogue`, `limitAssignments` (8) | May initiate ledger reversal and commercial-rule maker requests only where corresponding `*.create`/`*.modify` or `ledger.reverse` scope is present; no approval UI. |
| `FINANCE_CONTROLLER` | `dashboard`, `ledgerExplorer`, `feeRules`, `commissionRules`, `rewardRules`, `productCatalogue`, `limitCatalogue`, `limitAssignments`, `approvalsInbox` (9) | Checker execution paths are role/scope governed; generic approval UI requires `privileged:approve`. |
| `FINANCE_AUDITOR` | `dashboard`, `customers`, `agents`, `transfers`, `cashIn`, `cashOut`, `ledgerExplorer`, `reconciliation`, `feeRules`, `commissionRules`, `rewardRules`, `productCatalogue`, `limitCatalogue`, `limitAssignments`, `kycQueue`, `systemHealth`, `auditEvents` (17) | Read-only screens/actions; customer transaction history is contextual. No customer wallet-write or KYC-decision action. |
| `ADMINISTRATOR` | `dashboard`, `dashboardSettings`, `customers`, `agents`, `workforceAccess`, `superAdminRecovery` (6) | Has operational role assign/revoke, SUPPORT create/suspend, and external-signature recovery backend capabilities, but the current role-governance UI does not expose the operational-role actions. |
| `OPERATIONS` | `dashboard`, `customers`, `support`, `transfers`, `cashIn`, `cashOut`, `workforceAccess`, `systemHealth` (8) | Customer history, support, and health data are function-gated; no global C2C page. |
| `AGENT_NETWORK_MANAGER` | `dashboard`, `agents`, `limitCatalogue`, `limitAssignments` (4) | Agent lifecycle, applications, limit assignment, and (in the current worktree) funding governance have backend actions; the screen does not cover all of them. |
| `COMPLIANCE` | `dashboard`, `customers`, `kycQueue`, `complianceCases` (4) | Customer PII functions and KYC/compliance actions are independently granted. The compliance-case controller currently lacks catalogue function enforcement. |
| `RISK_FRAUD` | `dashboard`, `fraudCases` (2) | Fraud UI filters FRAUD rows client-side from a broader compliance-case endpoint; this is not a backend security boundary. |
| `CUSTOMER_SERVICE` | `dashboard`, `customers`, `support` (3) | Customer transaction history is a contextual Customer 360° action, not a global transaction menu route. |
| `TREASURY` | `dashboard`, `reconciliation` (2) | Reconciliation reporting only. |

The Layout shell also provides seven collapsible sections, a mobile drawer, and logout. Logout calls `DELETE /internal/a2/workforce/sessions/:id` with a reason (best-effort during local cleanup). Legacy aliases (`ledger`, `transactions`, `commercial`, `compliance`, `riskfraud`, `roles`, `approvals`, `workforce`, `system`) canonicalize to the same guarded screens and are not additional menu destinations.

## 3. Page-by-page inventory

Each page records its visible roles, active UI/actions, backend paths and function gates, plus separate API/UI/E2E status. “Missing” means a gap found in the current UI or backend; it does not authorize inventing a new route or permission.

### 3.1 Home & My Work

#### 1. Operational Dashboard — `dashboard`
- **Roles/route:** all 11 roles; `dashboard` is always visible.
- **UI/actions:** caller dashboard, role-configured widgets, and Customer Directory shortcut when `customer.view` is present. Dashboard content is assembled per widget; no write action is presented here.
- **Backend/API:** `GET /internal/a2/workforce/dashboard/my-dashboard`; widget reads use `GET /internal/a2/workforce/dashboard/widgets/:widgetKey`. Dashboard controller/widget registry enforces the caller's widget function grants. The dashboard may resolve a fallback with no widgets; it must not invent values.
- **API verification:** API static — controller and current screen calls inspected; not runtime-tested.
- **UI availability:** screen exists; widget outcomes depend on assigned scopes and backend data.
- **Actual UI/E2E:** Not performed.

#### 2. Dashboard Settings — `dashboardSettings`
- **Roles/route:** `SUPER_ADMIN`, `ADMINISTRATOR` (`workforce.dashboard.view`); dashboard assignment mutation additionally requires `workforce.dashboard.assign`.
- **UI/actions:** template list/detail and widget registry are shown; role assignment is edited and saved. No runtime template-authoring control.
- **Backend/API:** `GET /internal/a2/workforce/dashboard/templates`, `/assignments`, `/widget-registry`; `PUT /internal/a2/workforce/dashboard/assignments/:roleKey`.
- **API verification:** API static — controller/screen paths inspected; no live call.
- **UI availability:** existing structured settings interface for current APIs; template creation/editing is not a current capability.
- **Actual UI/E2E:** Not performed.

### 3.2 Customer & Agent Servicing

#### 3. Customer Directory & Servicing — `customers`
- **Roles/route:** `SUPER_ADMIN`, `FINANCE_AUDITOR`, `ADMINISTRATOR`, `OPERATIONS`, `COMPLIANCE`, `CUSTOMER_SERVICE` (`customer.view`).
- **UI/actions:** status/type-filtered directory; profile detail; Customer 360° contextual links; customer create (`customer.create`); wallet read/create (`customer.view_wallets`, `customer.create_wallet`); customer status updates (`customer.activate`, `.suspend`, `.close`); KYC display/assessment (`kyc.view`, `kyc.review`, `kyc.approve`, `kyc.reject`). PII sections are included in Batch 01 below and are fetched only when the matching customer PII scope is present. No customer profile/address/contact/identity-document write form is added in Batch 01.
- **Backend/API:** `GET/POST /customers`, `PATCH /customers/:id`; `GET/POST /customers/:id/wallets`; `GET /customers/:id/kyc`, `POST /customers/:id/kyc-assessment`; PII reads `GET /customers/:id/addresses`, `/contact-methods`, `/identity-documents`. Related endpoints include `GET /internal/customers/:id/transactions`, `/wallets`, `/support-tickets`, and `GET /internal/audit` for Customer 360° destination screens. Customer PII calls require their individual catalogue functions in the current customer controller.
- **API verification:** API static — routes and screen references inspected; not live. Internal investigation endpoints have separate scope gates.
- **UI availability:** present but partial; Batch 01 adds the already-authorized PII read panels. No list endpoint for the related fraud/compliance cases is added here.
- **Actual UI/E2E:** Not performed; automated React tests are not backend E2E.

#### 4. Agent Network Management — `agents`
- **Roles/route:** `SUPER_ADMIN`, `FINANCE_AUDITOR`, `ADMINISTRATOR`, `AGENT_NETWORK_MANAGER` (`agent.view`). Lifecycle actions are individually gated by `agent.activate`, `.suspend`, `.reactivate`, `.terminate`.
- **UI/actions:** paginated/status-filtered agent listing, detail/financial-position view, and lifecycle buttons when the corresponding function is granted.
- **Backend/API:** the screen calls `GET /internal/agents` and `/internal/agents/:id/financial-position`; the controller also exposes `GET /internal/agents/:id`, which the screen does not currently use. Lifecycle posts are under `/internal/admin/agents/:id/{activate,suspend,reactivate,terminate}`. Application review APIs exist under `/internal/agents/applications` and `agent.review_application`, but no full application queue/review UI is exposed here. Credential/outlet/terminal management functions likewise have no corresponding controls in this screen. Current pre-existing worktree changes also contain agent-funding governance APIs; those are outside this UI batch and are not represented as committed or validated here.
- **API verification:** API static — routes/current calls inspected; application/funding endpoints not run.
- **UI availability:** partial; listing, position, and lifecycle controls exist; applications, credentials, outlets/terminals, and funding workflows are missing from this page.
- **Actual UI/E2E:** Not performed.

#### 5. Support Inbox — `support`
- **Roles/route:** `SUPER_ADMIN`, `OPERATIONS`, `CUSTOMER_SERVICE` (`customer.manage_support_case`).
- **UI/actions:** status/customer-filtered paginated queue; detail drawer; allowed status transitions; assignment by manually entered workforce principal ID; message history with internal/customer-visible labels; customer-visible outbound message. Batch 02 adds the existing message-history and assignment actions, uses returned version values on writes, and disables status/assignment/message controls when the current backend transition rules do not permit them. There is no assignee-directory API.
- **Backend/API:** `GET /internal/support/tickets` returns `items` plus nested `pagination`; detail/history are `GET /tickets/:id` and `/tickets/:id/messages`; writes are `POST /tickets/:id/status`, `/assign`, `/resolve`, `/close`, `/messages` under `/internal/support`. All workforce routes require `customer.manage_support_case`; route/function authorization and response mapping are source-inspected, not live.
- **API verification:** API static — current controller/service paths and payload/response shapes inspected; no runtime request.
- **UI availability:** usable queue/detail/history/assignment/status/message controls for the existing APIs after Batch 02; workforce assignee lookup remains blocked by a missing directory endpoint.
- **Actual UI/E2E:** Not performed.

### 3.3 Money Movement

#### 6. Transfers / global transaction trace — `transfers`
- **Roles/route:** `SUPER_ADMIN`, `FINANCE_AUDITOR`, `OPERATIONS` (`transaction.view`).
- **UI/actions:** global UUID lookup for transfer; fee simulator (`POST /fees/calculate`) with input amount/fee parameters. The simulator is a calculation, not settlement. No global transaction search/list or mutation UI.
- **Backend/API:** `GET /transfers/:transferId`; fee simulation uses `POST /fees/calculate`; deposit/withdrawal detail routes are selected from the same screen. No `GET /transfers` list route is available.
- **API verification:** API static — detail and fee paths inspected; no runtime call. Global list is absent.
- **UI availability:** partial; UUID trace and simulator exist; general search/filter listing is blocked by missing list API.
- **Actual UI/E2E:** Not performed.

#### 7. Cash-In / deposit trace — `cashIn`
- **Roles/route:** `SUPER_ADMIN`, `FINANCE_AUDITOR`, `OPERATIONS` (`transaction.view`).
- **UI/actions:** same transaction screen initialized to `DEPOSIT`; UUID lookup and read-only pending-state notice; fee simulator is also shown.
- **Backend/API:** `GET /deposits/:depositId`, `POST /fees/calculate`; no global deposit list is wired into the screen.
- **API verification:** API static — controller paths inspected; not live.
- **UI availability:** partial; detail only, no list/search queue or settlement control (read-only is intentional).
- **Actual UI/E2E:** Not performed.

#### 8. Cash-Out / withdrawal trace — `cashOut`
- **Roles/route:** `SUPER_ADMIN`, `FINANCE_AUDITOR`, `OPERATIONS` (`transaction.view`).
- **UI/actions:** same transaction screen initialized to `WITHDRAWAL`; UUID lookup and fee simulation; no completion/cancel/fail controls.
- **Backend/API:** `GET /withdrawals/:withdrawalId`, `POST /fees/calculate`; no global withdrawal list is wired into the screen.
- **API verification:** API static — controller paths inspected; not live.
- **UI availability:** partial; detail only, no general search listing. No transaction mutation is exposed.
- **Actual UI/E2E:** Not performed.

**Contextual customer transaction history (not a sidebar page):** Customer 360° links to `transfers` with `customerId`; `GET /internal/customers/:id/transactions?page=…&limit=…&type=…` is paginated and includes wallet transfer, cash-in, cash-out, cash-to-cash, and funding types. UI supports type filter and page navigation under `customer.view_transactions`. This is not a general cross-customer transaction search.

### 3.4 Finance & Ledger

#### 9. Ledger & Reversals — `ledgerExplorer`
- **Roles/route:** `SUPER_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR` (`ledger.view`).
- **UI/actions:** currency-filtered chart of accounts; UUID journal lookup; maker reversal request (`ledger.reverse`); checker execution uses controller/privileged checker authority plus approved request ID and matching reason. Finance Auditor is read-only. UI shows no generic journal queue.
- **Backend/API:** `GET /ledger/accounts`, `GET /ledger/journals/:journalId`; `POST /ledger/journals/:journalId/reversal-request`; checker executes `POST /ledger/journals/:journalId/reversal` with approval reference. Approval checks are performed through the workforce approval endpoints. There is no `GET /ledger/journals` search/list route.
- **API verification:** API static — paths and screen gates inspected; not live. Journal backlog search is a confirmed missing API.
- **UI availability:** present but partial because lookup requires a UUID; governed reversal controls exist for permitted principals.
- **Actual UI/E2E:** Not performed.

#### 10. Reconciliation & Breaks — `reconciliation`
- **Roles/route:** `SUPER_ADMIN`, `FINANCE_AUDITOR`, `TREASURY` (`reconciliation.view`).
- **UI/actions:** two tabs: run in-house verification and trial balance. Results include integrity checks, binding discrepancies, dimension balances, and account rows. The menu label says “Breaks”, but no resolve/acknowledge workflow is exposed.
- **Backend/API:** `GET /internal/reconciliation/report`, `/trial-balance`; controller also exposes finance/activity reports not currently surfaced by this screen. The report endpoint runs current internal matching; it is not external bank reconciliation.
- **API verification:** API static — both screen endpoints exist in source; not live.
- **UI availability:** present for reporting/trial balance; break resolution is not in the UI/API and requires governance/product decisions before implementation.
- **Actual UI/E2E:** Not performed.

### 3.5 Commercial & Risk Controls

#### 11. Fee Rules — `feeRules`
- **Roles/route:** `SUPER_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR` (`fee_rule.view`).
- **UI/actions:** current shared `CommercialRulesScreen` Fees tab, with read-only registry. Batch 01 replaces raw JSON with structured rows/details. No create/modify/request/execute UI yet.
- **Backend/API:** `GET /internal/fee-rules`, `/internal/fee-rules/:id`; maker request `POST /internal/fee-rules`, `PATCH /internal/fee-rules/:id`; separate approved execution routes `/internal/fee-rules/changes/:approvalId/execute-create|execute-modify`. Writes use the existing governed commercial-rule workflow and must not be replaced with direct writes.
- **API verification:** API static — routes and governance source inspected; no API call.
- **UI availability:** read view available after Batch 01; maker/checker actions remain missing.
- **Actual UI/E2E:** Not performed.

#### 12. Commission Rules — `commissionRules`
- **Roles/route:** `SUPER_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR` (`commission_rule.view`).
- **UI/actions:** shared Commission tab; structured read-only rows/details after Batch 01. No mutation forms.
- **Backend/API:** `GET /internal/commission-rules`, `GET /:id`; `POST`/`PATCH` maker requests and `/changes/:approvalId/execute-create|execute-modify` execution routes. Existing commercial governance is mandatory.
- **API verification:** API static — source paths/gov workflow inspected; no live request. In the reviewed controller, list/detail endpoints do not consistently check `commission_rule.view`; frontend scope gating is not backend authorization.
- **UI availability:** read view available after Batch 01; governed maker/checker controls remain missing.
- **Actual UI/E2E:** Not performed.

#### 13. Reward Rules — `rewardRules`
- **Roles/route:** `SUPER_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR` (`reward_rule.view`).
- **UI/actions:** shared Rewards tab; structured read-only rows/details after Batch 01. No mutation forms or reward-crediting action.
- **Backend/API:** `GET /internal/reward-rules`, `GET /:id`; `POST`/`PATCH` maker requests and `/changes/:approvalId/execute-create|execute-modify` execution routes. Reward crediting is not an existing registry mutation and is not added.
- **API verification:** API static — paths/gov source inspected; no live call. Reward list/detail controller uses workforce-type access rather than the expected `reward_rule.view` function; this is a backend authorization gap.
- **UI availability:** read view available after Batch 01; governed maker/checker controls missing.
- **Actual UI/E2E:** Not performed.

#### 14. Product Catalogue — `productCatalogue`
- **Roles/route:** `SUPER_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR` (`product.view`).
- **UI/actions:** shared Products tab; structured read-only rows/details after Batch 01. No mutation form.
- **Backend/API:** `GET /internal/products`, `GET /internal/products/:code`; create/modify proposals via `POST /internal/products`, `PATCH /internal/products/:code`, then governed `/changes/:approvalId/execute-create|execute-modify` routes.
- **API verification:** API static — routes/governance inspected; no live call. Product list/detail controller uses workforce-type access instead of its expected view function; backend authorization gap.
- **UI availability:** read view available after Batch 01; governed maker/checker controls missing.
- **Actual UI/E2E:** Not performed.

#### 15. Limit Catalogue — `limitCatalogue`
- **Roles/route:** `SUPER_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`, `AGENT_NETWORK_MANAGER` (`limit.view`).
- **UI/actions:** shared Limits tab. At baseline it requested nonexistent `GET /internal/limit-catalogue`. Batch 01 changes the read-only view to existing profile/rule list routes and renders both as structured tables. No limit mutation controls are added.
- **Backend/API:** `GET /internal/limit-profiles`, `/internal/limit-rules`, plus profile-specific rule/detail reads. `POST`/`PATCH` profile/rule mutation endpoints exist and check `limit.modify`, but they call services directly and do not use the commercial maker/checker execute workflow. **Do not expose these mutations as governed actions.**
- **API verification:** API static — incorrect baseline URL confirmed absent; replacement paths confirmed in controller. No runtime response was tested. No `GET /internal/limit-catalogue` route exists.
- **UI availability:** read view available after Batch 01; write controls intentionally withheld due direct mutation/no maker-checker.
- **Actual UI/E2E:** Not performed.

#### 16. Limit Assignments — `limitAssignments`
- **Roles/route:** `SUPER_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`, `AGENT_NETWORK_MANAGER` (`limit.view` or `agent.assign_limit`).
- **UI/actions:** assignment listing; customer-context listing; agent profile assignment with `agent.assign_limit`; Batch 03 adds on-demand filtered/paginated usage and reservation read-only panels to the shared screen. No customer assignment form and no reservation-release mutation are exposed. Staleness is shown as a diagnostic signal only.
- **Backend/API:** assignment routes include `GET /internal/limit-assignments`, `/customer/:id` and related subject filters; agent `POST /internal/limit-assignments`. Read-only diagnostics are `GET /internal/limit-usages` and `/internal/limit-reservations`. Current controllers enforce workforce principal type on those reads, not `limit.view`; Batch 03's `limit.view` check is frontend presentation gating only. Manual release exists separately at `POST /internal/limit-reservation-recovery/release`, requires a `PRIVILEGED` workforce principal plus a reason and is audited; it remains intentionally absent from this screen pending explicit operational UI authorization review. Batch 01 corrected the help text that previously named a nonexistent `/limit-operations/:id` route.
- **API verification:** API static — paths, response shapes, and controller checks inspected; not live.
- **UI availability:** assignment and agent-profile action remain available; Batch 03 adds structured diagnostics. Backend function-level authorization is still a blocker; manual release has not been added.
- **Actual UI/E2E:** Not performed.

### 3.6 Compliance & Risk

#### 17. KYC Assessment Lookup & Review — `kycQueue`
- **Roles/route:** `SUPER_ADMIN`, `FINANCE_AUDITOR`, `COMPLIANCE` (`kyc.view` and/or `kyc.review`, `.approve`, `.reject`).
- **UI/actions:** manual customer UUID lookup or Customer 360° context; assessment display; permitted decision statuses are scope-specific. This is not a pending-customer queue.
- **Backend/API:** `GET /customers/:id/kyc`; `POST /customers/:id/kyc-assessment` with `kyc.review`/`.approve`/`.reject` authorization. There is no queue/list API wired into this page.
- **API verification:** API static — routes and scope checks inspected; not live.
- **UI availability:** present but lookup-centric; no pending queue.
- **Actual UI/E2E:** Not performed.

#### 18. Compliance Case Lookup — `complianceCases`
- **Roles/route:** `SUPER_ADMIN`, `COMPLIANCE` (`compliance.manage_case`).
- **UI/actions:** manual UUID/context lookup and client-side category filter; displays non-FRAUD cases. No create/update/comment/evidence/assignment UI.
- **Backend/API:** `GET /customers/:id/compliance-cases`; backend also has case write routes, but the current customer compliance controller does not apply catalogue function checks. Its route does not provide a category-specific access boundary. **UI filters are not security enforcement.** Do not expose the write routes in Admin Web until backend authorization is addressed/confirmed.
- **API verification:** API static — route exists; no live call. Function-level authorization gap recorded.
- **UI availability:** partial/read-only; missing case management actions are blocked pending backend authorization evidence.
- **Actual UI/E2E:** Not performed.

#### 19. Fraud Case Lookup — `fraudCases`
- **Roles/route:** `RISK_FRAUD` (`risk_fraud.manage_fraud_case`).
- **UI/actions:** manual UUID or Customer 360° lookup; screen filters returned results to FRAUD category in the browser. No fraud case actions are exposed.
- **Backend/API:** reuses `GET /customers/:id/compliance-cases`; controller does not accept the screen's category as a server filter and does not enforce `risk_fraud.manage_fraud_case`. The screen explicitly warns that client-side filtering is not a security boundary.
- **API verification:** API static — broad case-list route exists; no live call. Backend authorization/category-isolation gap.
- **UI availability:** partial/read-only; do not treat the frontend guard as protecting the endpoint.
- **Actual UI/E2E:** Not performed.

### 3.7 Platform Administration

#### 20. Workforce Overview & Support Provisioning — `workforceAccess`
- **Roles/route:** `SUPER_ADMIN`, `ADMINISTRATOR`, `OPERATIONS` (overview/create/suspend functions vary by role).
- **UI/actions:** overview widget; one-time SUPPORT user provisioning; Batch 01 corrects the backend field mapping, adds a structured role/session view, and adds SUPPORT disable by ID with optional reason under `workforce.user.suspend`. There is no GET list of workforce/support identities, so the form does not pretend to browse them. No enable/re-enable action is exposed; the backend enable endpoint has no matching catalogue function.
- **Backend/API:** `GET /internal/a2/workforce/dashboard/widgets/workforce-overview`; `POST /internal/admin/support/workforce-users`; `POST /internal/admin/support/workforce-users/:id/disable`. `POST .../:id/enable` exists but lacks catalogue-function enforcement and is intentionally not surfaced.
- **API verification:** API static — paths/functions/overview shape inspected; no request. Shape: `activeWorkforceHeadcount`, `roleDistribution`, `activeSessionCount`.
- **UI availability:** structured overview/create/disable available after Batch 01; identity list remains blocked by missing list API.
- **Actual UI/E2E:** Not performed.

#### 21. Role Governance / Finance Role Assignments — `roleGovernance`
- **Roles/route:** sidebar route is currently `SUPER_ADMIN` only, with `workforce.role.assign`/`.revoke`; other role-definition proposal functions are not surfaced.
- **UI/actions:** tabs for assign/revoke Finance roles; manual principal ID/effective dates/approval IDs. It does not list current role assignments, expose the Administrator operational-role actions, or manage role-definition proposals.
- **Backend/API:** Finance and operational assignment use `POST /internal/a2/workforce/roles` and `DELETE /internal/a2/workforce/roles/:principalId/:roleKey`; operational targets use `workforce.role.assign_operational`/`.revoke_operational`. Role-definition governance also exposes `GET /internal/a2/workforce/role-definitions/proposals[/:id]`, `POST` proposal/approve/reject/apply routes. No endpoint lists current role assignments. Generic current approval queue is not interchangeable with role-definition proposal listing.
- **API verification:** API static — controllers and UI call paths inspected; no live call. Current-assignment list endpoint is absent.
- **UI availability:** partial; Finance assignment/revocation only.
- **Actual UI/E2E:** Not performed.

#### 22. Privileged Approvals — `approvalsInbox`
- **Roles/route:** `FINANCE_CONTROLLER` role plus `privileged:approve`.
- **UI/actions:** manual approval UUID and optional comment; Batch 02 adds both approve and reject calls on existing POST routes. The UI still requires an ID supplied by an existing workflow; it does not show pending items or approval details. Agent funding rejections remain on their dedicated atomic workflow; the generic reject route explicitly refuses those IDs.
- **Backend/API:** `POST /internal/a2/workforce/approvals/:id/approve` and `/reject`; generic request route is `POST /internal/a2/workforce/approvals/request`. There is no generic `GET /approvals` or `GET /approvals/:id` queue/detail. Some role-definition proposals have their own GET list/detail endpoints.
- **API verification:** API static — existing POST paths and funding rejection guard inspected; queue/detail routes confirmed absent; not live.
- **UI availability:** approve/reject decision controls are present after Batch 02 for externally supplied IDs; queue/detail remain backend blockers.
- **Actual UI/E2E:** Not performed.

#### 23. Super-Admin Recovery — `superAdminRecovery`
- **Roles/route:** `ADMINISTRATOR` (`workforce.super_admin.recover`); Super Admin is deliberately not the consumer role.
- **UI/actions:** paste externally signed RS256 recovery statement and submit. Batch 01 changes the successful response from raw JSON text to named result fields; it does not generate/sign a statement or weaken the recovery ceremony.
- **Backend/API:** `POST /internal/a2/workforce/super-admin/recovery`; requires function/ADMINISTRATOR/MFA checks and a valid externally signed statement.
- **API verification:** API static — controller/service response shape inspected; no live request.
- **UI availability:** existing submit interface; structured success result after Batch 01.
- **Actual UI/E2E:** Not performed.

#### 24. System Health — `systemHealth`
- **Roles/route:** `SUPER_ADMIN`, `FINANCE_AUDITOR`, `OPERATIONS` (`metrics.view`, `diagnostics.view`, `outbox.view`); notification panel additionally uses `notification.view_deliveries`.
- **UI/actions:** metrics, diagnostics, outbox are read-only. Batch 01 replaces raw JSON with structured tables/details and adds a paginated/filterable notification-delivery table visible only to the matching frontend function. No retry/replay/mutation controls.
- **Backend/API:** `GET /internal/metrics`, `/diagnostics`, `/outbox` each enforce their matching function in OperationsController. `GET /internal/notifications/deliveries?page=&limit=&status=&channel=&eventType=` exists, but AdminNotificationController currently checks workforce principal type only, not `notification.view_deliveries`; this remains a backend authorization gap and is explicitly not fixed by frontend gating.
- **API verification:** API static — routes/response shapes inspected; not live. Notification route is present but its controller's function-level authorization is deficient.
- **UI availability:** structured read-only panels and notifications available after Batch 01; notification endpoint's server-side function gate remains a blocker.
- **Actual UI/E2E:** Not performed.

#### 25. Audit & Security Events — `auditEvents`
- **Roles/route:** `SUPER_ADMIN`, `FINANCE_AUDITOR` (`audit.search`).
- **UI/actions:** optional entity UUID and global search; bounded limit 100; read-only table. Customer context is carried from Customer 360°.
- **Backend/API:** `GET /internal/audit?entityType=&entityId=&correlationId=&limit=`; the Admin Web sends `entityId`/`limit`. The endpoint intentionally has no catalogue function check because existing SUPPORT audit use is documented and tested; frontend `audit.search` does not become backend authorization.
- **API verification:** API static — screen endpoint and controller behavior inspected; no live request.
- **UI availability:** basic search table exists; no advanced query or export UI.
- **Actual UI/E2E:** Not performed.

## 4. Cross-page authorization and integration findings

1. **Frontend gating is not backend authorization.** Record separately: `reward_rule.view` and `product.view` list/detail controller gaps; notification deliveries and limit-assignment/usage/reservation reads currently use workforce-type checks without their corresponding catalogue view-function enforcement; customer compliance-case access does not enforce the catalogue function/category server-side; audit is intentionally left authentication-only to preserve tested SUPPORT use. The UI must not be described as fixing these server-side conditions. Batch 03 shows limit diagnostics only for `limit.view`, but that is presentation gating, not a backend authorization fix.
2. **Commercial maker/checker:** fee, commission, reward, product create/modify routes require governed request/approval/execute flows; the generic approval UI does not supply a list/detail queue. Do not replace this with direct mutation calls or invent approval IDs.
3. **Limits are not commercial-governed:** existing profile/rule writes call services directly after `limit.modify`; no maker/checker execution path was verified. Batch 01 adds read-only lists only.
4. **Missing endpoints must remain explicit:** global transaction/journal list, generic approval list/detail, current workforce identity list, and customer compliance queue/filter are not inferred from similarly named detail/write routes.
5. **Contextual navigation:** Customer 360° preserves `customerId` for transaction history, KYC, compliance/fraud, support, audit, and limits. This context is in-app state, not a backend entitlement.
6. **Other known UI omissions:** Agent applications/credentials/outlets/terminals/funding; Support assignee directory (no API); Reconciliation break resolution; operational role and role-definition governance; generic approval queue/detail. Manual limit-reservation release has an existing privileged-only backend route but remains unexposed pending explicit operational UI authorization review. These remain backlog entries; Batches 02 and 03 add only the documented existing support/checker actions and read-only limit diagnostics.

## 5. Batch 01 — Super Admin/shared screen completion

**Scope:** shared/read-oriented screens and safe existing controls only. No migration, financial-rule change, deployment, or backend authorization change.

- Commercial registry tabs now render structured tables/details; Limits reads use `/internal/limit-profiles` and `/internal/limit-rules` instead of the nonexistent `/internal/limit-catalogue`.
- System Health metrics/diagnostics/outbox now render structured views; the notification delivery panel is scope-gated in the UI and remains flagged for server-side authorization.
- Workforce overview now maps `activeWorkforceHeadcount`, `roleDistribution`, `activeSessionCount`; SUPPORT disable is exposed only under `workforce.user.suspend`, with a direct ID input (no invented list API).
- Customer 360° adds permission-gated, lazy-loaded address/contact/identity-document reads using their existing controller endpoints.
- Recovery success results display named fields rather than raw JSON. Limit assignment help text names the actual usage/reservation read routes.
### Batch 01 validation record

- **UI TypeScript:** `npm run ts:check` — passed.
- **Admin Web tests:** `npm test -- --runInBand` — passed, 10 suites / 78 tests, including all 11-role menu visibility/render checks and the new shared-screen authorization/path tests. API calls in component tests are mocked.
- **Production build:** `npm run build` — passed. Vite emitted its existing CommonJS Node API deprecation warning; no build failure.
- **API verification:** static controller/path/authorization-source inspection only. No authenticated HTTP call or database-backed API request was made.
- **Actual interface/E2E:** not performed; no running backend or authenticated browser session was exercised. Jest component tests are not E2E.
- **Changed Batch 01 files:** `apps/admin-web/src/components/StructuredData.tsx`; `apps/admin-web/src/screens/authenticated/CommercialRulesScreen.tsx`, `CustomerDirectoryScreen.tsx`, `LimitAssignmentScreen.tsx`, `SuperAdminRecoveryScreen.tsx`, `SystemHealthScreen.tsx`, `WorkforceAdminScreen.tsx`, and `navigation-access.ts`; `apps/admin-web/__tests__/admin-shared-panels.test.tsx`; and this inventory document. Only these files are eligible for the Batch 01 commit; pre-existing dirty/untracked work is excluded.

## 6. Batch 02 — Support operations and checker rejection

**Scope:** expose existing support message history/assignment endpoints and the existing generic approval rejection route. No backend source, authorization policy, migration, financial rule, or new endpoint is changed. The generic approval list/detail blocker remains explicit.

- Support Inbox now renders the API's `items`/nested `pagination` response, message history (including internal/customer-visible classification), existing assignment by workforce principal ID, and customer-visible outbound messages. It passes the current version on assignment/status updates and disables status/assignment/message actions that the existing service transition rules disallow. The missing assignee directory is documented rather than inferred.
- Privileged Approvals now offers both existing `approve` and generic `reject` POST decisions with an optional comment. The backend remains authoritative for checker authorization. A visible note explains that agent-funding requests must use the dedicated atomic rejection flow; generic `reject` intentionally refuses those approval IDs.
- **UI verification:** `npm test -- --runInBand` — passed, 11 suites / 82 tests, including four Batch 02 component tests using mocked `ApiClient` responses. These are not live backend tests or E2E.
- **TypeScript:** `npm run ts:check` — passed.
- **Production build:** `npm run build` — passed; Vite emitted its existing CommonJS Node API deprecation warning.
- **API verification:** static inspection of the current support controller/service and workforce approval controller only. No authenticated HTTP or database-backed request was made.
- **Actual interface/E2E:** not performed.
- **Changed Batch 02 files:** `apps/admin-web/src/screens/authenticated/SupportTicketsScreen.tsx`, `ApprovalsScreen.tsx`, `apps/admin-web/__tests__/admin-batch-02-support-approvals.test.tsx`, and this inventory document. Pre-existing unrelated changes are excluded from this batch.

## 7. Batch 03 — Limit usage and reservation diagnostics

**Scope:** add structured, on-demand, read-only usage/reservation diagnostics to Limit Assignments using the existing GET routes. No mutations, recovery controls, backend authorization changes, migrations, or financial-rule changes are included.

- Usage and reservation panels expose the existing query filters and page navigation, render typed table columns/details, and preserve amounts in minor units. Requests are lazy and are made only after a user selects Search.
- The UI requests diagnostics only when the principal has `limit.view`. The current backend routes enforce workforce principal type but not the catalogue function; the UI check is not a replacement for backend authorization.
- Stale status/age are displayed as diagnostic-only signals. The backend's stale threshold does not prove a reservation is orphaned. The existing privileged manual-release route is intentionally not exposed pending explicit operational UI authorization review.
- **API verification:** static inspection of `LimitOperationsController`, `LimitDiagnosticsService`, and `LimitAssignmentController`; no authenticated HTTP or database-backed request was made.
- **UI verification:** `npm test -- --runInBand` — passed, 12 suites / 84 tests, including two Batch 03 component tests using mocked `ApiClient` responses; not live API tests or E2E.
- **TypeScript:** `npm run ts:check` — passed.
- **Production build:** `npm run build` — passed; Vite emitted its existing CommonJS Node API deprecation warning.
- **Actual interface/E2E:** not performed.
- **Changed Batch 03 files:** `apps/admin-web/src/screens/authenticated/LimitAssignmentScreen.tsx`, `apps/admin-web/__tests__/admin-batch-03-limit-diagnostics.test.tsx`, and this inventory document. Pre-existing unrelated changes are excluded from this batch.
