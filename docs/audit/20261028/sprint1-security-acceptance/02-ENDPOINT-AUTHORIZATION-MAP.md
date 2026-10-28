# 02 — Endpoint and Authorization Mapping

## Shared authorization path

- `src/main.ts` installs the global API prefix, validation and global exception handling; `src/app.module.ts` registers `RuntimeAccessGuard` as `APP_GUARD`.
- `RoutePolicyRegistry.resolve` assigns auth mode and generic route policies. For `WORKFORCE_SESSION`, the guard authenticates the workforce bearer. The current guard enforces explicitly declared `requiredFunctions`/`requiredRoles`/`requiredScopes`, but does **not** turn `allowedPrincipalTypes` into a catalogue-function grant. Controllers still need their own type/function checks.
- `AuthorizationService.evaluate` checks principal-type allowlists, declared scopes/functions/roles, and resource scopes; `checkCustomerScope(SELF)` compares customer IDs for CUSTOMER principals. For non-CUSTOMER workforce principals, the current implementation returns no customer-scope mismatch after `allowedPrincipalTypes` has permitted them. That behavior is documented in source as deliberate for workforce access; it is not a substitute for case-specific entitlement or assigned-customer policy.
- Authorization function catalogue and role grants are in `src/authorization-catalogue/authorization-catalogue.seed.ts`. Function codes present in the UI or seed do not secure an endpoint unless guard/controller/service calls enforce them.

## P0-01 customer compliance

### HTTP route table

| Method | Full route | Handler | Current access evidence |
|---|---|---|---|
| POST | `/api/v1/customers/:id/compliance-cases` | `createCase` | Generic customer route policy; no controller function call |
| GET | `/api/v1/customers/:id/compliance-cases` | `listCases` | Same; returns all categories for the customer |
| GET | `/api/v1/customers/:id/compliance-cases/:caseId` | `getCase` | Same; service constrains customerId + caseId |
| PATCH | `/api/v1/customers/:id/compliance-cases/:caseId` | `updateCase` | Same; state transition/version checks in service, no function gate |
| POST | `/api/v1/customers/:id/compliance-cases/:caseId/comment` | `addComment` | Same; DTO actor accepted |
| GET | `/api/v1/customers/:id/compliance-cases/:caseId/comments` | `listComments` | Same |
| POST | `/api/v1/customers/:id/compliance-cases/:caseId/evidence` | `addEvidence` | Same; `uploadedBy` accepted from client |
| GET | `/api/v1/customers/:id/compliance-cases/:caseId/evidence` | `listEvidence` | Same |
| POST | `/api/v1/customers/:id/compliance-cases/:caseId/assignment` | `assignCase` | Same; DTO actor/assignee accepted |
| GET | `/api/v1/customers/:id/compliance-cases/:caseId/assignments` | `listAssignments` | Same |
| GET | `/api/v1/customers/:id/compliance-cases/:caseId/history` | `listHistory` | Same |

The policy branch is generic `path.startsWith('/api/v1/customers/')` in `src/authorization/route-policy-registry.ts` and allows `CUSTOMER`, `OPERATOR`, `SERVICE`, `PRIVILEGED`, sets `customerAccess: SELF`, and declares no `requiredFunctions`. `CustomerComplianceController` contains no `AuthorizationService` dependency/call. `ComplianceScreen` requires `compliance.manage_case`; `RiskFraudScreen` requires `risk_fraud.manage_fraud_case`; these are UI-only gates for these endpoints today.

### Function grants

- `compliance.manage_case`: assigned in seed to COMPLIANCE and SUPER_ADMIN.
- `risk_fraud.manage_fraud_case`: assigned to RISK_FRAUD only; source descriptions explicitly limit it to FRAUD cases.
- `CUSTOMER_SERVICE`, OPERATIONS and generic workforce types are not granted these case functions by the shown role seed, but generic customers route policy can still allow some of those principal types unless a controller-specific function check is added.
- Customer-owned capability policy evidence reader calls `CustomerComplianceService.listCases(context.customerId)` internally (`src/policy/capability-policy-source-readers.ts:289-294`); this is not another controller route found in source. Audit its caller's customer policy context, but do not confuse it with Admin case access.

### Data/persistence facts

`CustomerComplianceService` persists `CustomerComplianceCase`, `ComplianceCaseComment`, `ComplianceCaseEvidence`, `ComplianceCaseAssignment`, and `ComplianceCaseHistory`; it uses transactions for case create/update/comment/evidence/assignment, and calls `AuditService`. Queries for most child rows bind `caseId` and `customerId`; history lookup first validates the customer/case pair then queries by caseId. The security gap is authorization/category/actor provenance, not absence of basic DB scoping. No controller-level PG auth suite was found in the current scan; `test/customer-compliance.service.spec.ts` is a service/unit suite.

## P0-02 notification deliveries

### Route and neighboring paths

| Method | Full route | Controller / check | Notes |
|---|---|---|---|
| GET | `/api/v1/internal/notifications/deliveries` | `AdminNotificationController.listDeliveries` → `requireWorkforce` | Workforce principal type only; pagination/filtering; SQL is parameterized; response hides destination/payload but exposes message and identifiers. |
| GET | `/api/v1/internal/notifications/provider-status` | `AdminNotificationProviderController` → `requireFunction(notification.view_deliveries)` | Separate endpoint, function check. |
| POST | `/api/v1/internal/notifications/test-send` | Provider controller → `requireFunction(notification.test_send)` | Separate function, rate-limited/audited; do not change. |
| GET/POST | `/api/v1/internal/notifications/events`, templates, changes, execute | `NotificationRegistryController`/`NotificationRegistryService` | Separate workforce/role/MFA/maker-checker governance contract. |
| GET | `/api/v1/internal/outbox` | `OperationsController.getOutbox` → `requireFunction(outbox.view)` | Adjacent route returns payload through `OutboxService.toView`; outbox enqueue redacts payload, but verify policy and redaction. Not the same route or entitlement. |

The notification registry route-policy branch explicitly includes events/templates/changes but excludes deliveries; delivery path reaches generic internal workforce-session handling. Controller rejects no principal and AGENT/CUSTOMER/AGGREGATOR; it accepts other authenticated principal types. Existing real-PG test explicitly proves SUPPORT, OPERATOR, SERVICE and PRIVILEGED succeed with empty scopes. That is the current test contract, not proof those roles are approved for the data.

`notification.view_deliveries` is an assignable function seeded to SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS. Admin System Health requires this function before calling the API; notification management's delivery panel also gates access. This UI/catalogue/server difference is the acceptance issue. Existing tests assert destination/payload/password/PIN/API-key absence but intentionally allow notification message body and customer recipient ID.

## P0-03 limit diagnostics

| Method | Full route | Current check | Relevant data |
|---|---|---|---|
| GET | `/api/v1/internal/limit-usages` | Runtime path type policy plus `LimitOperationsController.requireWorkforce` | All matching rows; caller-selectable principalId, profile, product, dimension, window and page; amounts/counts/windows. |
| GET | `/api/v1/internal/limit-reservations` | Same | Status, principalId, idempotency/correlation identifiers, date range and stale state; projection excludes `request_hash`. |
| POST | `/api/v1/internal/limit-reservation-recovery/release` | `requirePrivileged` (principal type PRIVILEGED), service/audit logic | Separate state mutation, reasoned manual release. Must not be accidentally widened or conflated with GET policy. |
| GET/POST/PATCH | `/api/v1/internal/limit-assignments...` | `limit.view`, `limit.modify`, or distinct agent assignment gates in controller | Separate assignment workflow; stricter function-level checks. |
| GET | `/api/v1/internal/limit-profiles`, `/internal/limit-rules` | Catalogue-specific controller checks | Separate registry read surfaces. |

`/api/v1/internal/limit-*` receives WORKFORCE_SESSION with allowed types OPERATOR/SERVICE/PRIVILEGED in `RoutePolicyRegistry`; the diagnostics controller mirrors that type set. Admin diagnostics fetch only when `principal.scopes` contains `limit.view`. The function is assigned to SUPER_ADMIN, FINANCE_PREPARER, FINANCE_CONTROLLER, FINANCE_AUDITOR and AGENT_NETWORK_MANAGER. Existing real-PG diagnostic tests test type allowlist, not function-scope denial.

`LimitDiagnosticsService` is SELECT-only and has no ledger mutation. This reduces direct financial integrity risk but does not prevent unauthorized disclosure of platform-wide customer/agent operational limits. `principalId` is a filter, not a caller scope.

## Alternate-route/bypass conclusions

- **Compliance:** no second HTTP controller for `/compliance-cases` was found. The customer capability evidence reader uses the service internally under a separate policy-evaluation path; it is not a substitute authorization check on the Admin/controller route. General `/customers/:id` policy is the relevant bypass surface.
- **Notification:** `/internal/outbox` is adjacent and returns outbox payload under `outbox.view`; provider/status and registry APIs have separate gates. No manual delivery retry endpoint exists in V1. Ensure the proposed fix does not accidentally change outbox/provider/registry policy.
- **Limits:** assignment/catalogue endpoints are distinct and function-gated; recovery is a separate PRIVILEGED-only POST. Agent/customer self-limit views are not equivalent to cross-principal diagnostics. No route should expose the same diagnostics without the chosen scope.
