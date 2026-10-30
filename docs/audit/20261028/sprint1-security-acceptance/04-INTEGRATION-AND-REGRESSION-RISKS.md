# 04 — Integration and Regression Risks

## 1. Three parallel changes share a policy hot spot

- **Arena 1 (compliance):** likely touches `CustomerComplianceController`, its DTOs/service, `RoutePolicyRegistry`, authorization catalogue, and possibly customer-case service tests. The generic customer route branch and Principal customer-access logic are shared with KYC, PoA, customer app and Customer 360. A too-broad policy condition could authorize every `/customers/:id` path or accidentally shadow a more specific policy; a too-narrow controller check can break legitimate KYC/customer operations.
- **Arena 2 (notification):** likely touches `AdminNotificationController`, `RoutePolicyRegistry`, notification function grants and delivery diagnostics tests. Existing `v1-hardening-09` tests assert SUPPORT, OPERATOR, SERVICE and PRIVILEGED without scopes are allowed. Reconcile intentional legacy SUPPORT access before changing expectations. Do not widen registry/provider/test-send policy in a shared controller or make test-send scope imply delivery access.
- **Arena 3 (limits):** likely touches `LimitOperationsController`, `RoutePolicyRegistry`, role/function grants, and `v1-limit-05` tests. Existing tests assert broad principal-type access. Do not conflate GET diagnostics with `/internal/limit-assignments` (already has function gates) or the `/limit-reservation-recovery/release` privileged POST.

## 2. Authentication mode / 401-vs-403 drift

`RuntimeAccessGuard` documents an intentional distinction: blanket guard enforcement of every `allowedPrincipalTypes` policy caused several existing suite status-code/message changes, so workforce-session routes primarily enforce explicit catalogue `required*` gates there and rely on controller checks for type allowlists. Use narrow, explicit policy/controller checks and preserve established 401/403 response contract. Do not implement a broad catch-all guard change as a shortcut; tests must prove the exact endpoint behavior.

## 3. Compliance category and identity hazards

- The case endpoint family is generic customer URL space, not a separate `/internal/compliance` path. Adding an unscoped `requireFunction` to every method may still fail to differentiate FRAUD from non-FRAUD categories.
- `risk_fraud.manage_fraud_case` and `compliance.manage_case` are separate grants. List results must be filtered by category before serialization; writes must load category under transaction/lock and authorize against persisted category, not a caller-controlled body field.
- Existing service functions accept actor values as commands. If Arena 1 only adds auth calls but leaves DTO `actor`/`uploadedBy`, audit history remains forgeable. Derive actor from the verified request principal and use that same identity throughout service/audit writes.
- Cross-customer mismatch must use both customer ID and case ID and return a non-enumerating response contract. Ensure history and subresource queries remain bound to the selected case/customer.

## 4. Notification data-scope and compatibility hazards

- Delivery list returns `message` and `recipientId` as well as operational statuses. Role approval must consider message/body content; excluding destination/payload does not mean the projection is non-sensitive.
- Existing test source creates users with empty `scopes`; it does not exercise catalogue grant mapping. The test's explicit SUPPORT authorization conflicts with the UI and role-grant list. Resolve this without silently changing support workflow.
- `FINANCE_CONTROLLER + privileged:approve` can access registry governance workspace for maker-checker, but this should not grant delivery diagnostics unless policy says so.
- Keep `provider-status` (`notification.view_deliveries`), `test-send` (`notification.test_send`), notification registry maker/checker/MFA, and outbox (`outbox.view`) as separate contracts.
- Ensure a delivery authorization patch is additive to safe SQL projection/pagination and does not introduce a mutation/retry route. The V1 manual retry deferral remains.

## 5. Limit authorization and financial-safety hazards

- Diagnostics GETs are SELECT-only; their current information scope is global across many principals, not just current admin's subject. Tests prove data querying but no caller-scope isolation.
- Changing route policy from principal-type to `limit.view` must not affect reserve/commit/release flow enforcement or non-admin agent/customer limit views.
- The service/manual recovery endpoint is a state-changing financial-control boundary; preserve its `PRIVILEGED` type, human reason, audit, row lock and idempotent transition. Do not put release under a new read function.
- Do not infer that `limit.view` authorizes `limit.modify`, `agent.assign_limit` or manual recovery.

## 6. Combined integration order

1. Obtain policy-owner decisions for compliance category/scope, notification delivery roles, and limit diagnostics policy.
2. Review each arena diff independently against `01-P0-ACCEPTANCE-MATRIX.md` before merge.
3. Integrate code with targeted resolution in shared route policy/seed files; inspect commit ancestry and source SHA after merges.
4. Run focused DB HTTP tests for all three, including P0-04 actor spoof and cross-category behavior.
5. Run full backend unit + full sequential PG + Admin typecheck/component suite/build on one integrated SHA.
6. Re-run tests after any cross-arena conflict resolution; per-arena green runs do not prove combined behavior.

No integration is accepted while one arena branch is absent, policy remains ambiguous, or focused negative tests cannot execute against real PostgreSQL.
