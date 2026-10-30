# 06 — Outstanding Policy Questions

These questions must be answered by the named policy owner before independent acceptance. The reviewer does not invent roles or scope grants.

| ID | Question | Source conflict / consequence | Owner |
|---|---|---|---|
| Q-01 | Which functions/categories may COMPLIANCE and RISK_FRAUD roles read and mutate? Is SUPER_ADMIN allowed non-FRAUD compliance only? | Function descriptions and role seeds separate non-FRAUD `compliance.manage_case` (COMPLIANCE/SUPER_ADMIN) from FRAUD `risk_fraud.manage_fraud_case` (RISK_FRAUD), but one shared route family/service currently has no category-aware enforcement. | Compliance Product + Security |
| Q-02 | Are customer principals permitted to list/create their own compliance cases? | Generic `/customers/:id` policy allows CUSTOMER with SELF; current UI is workforce-only, and no self-service requirement was found in this acceptance scan. | Product + Compliance |
| Q-03 | Is workforce compliance access global or constrained to assigned customer/portfolio/region? | `checkCustomerScope(SELF)` does not bind non-CUSTOMER workforce caller to a customer subject. | Compliance Product + Security |
| Q-04 | Which delivery-reader roles are authorized? | `notification.view_deliveries` is granted to SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS, while current PG test explicitly allows SUPPORT, OPERATOR, SERVICE, PRIVILEGED without scopes. | Operations + Security + Product |
| Q-05 | Is notification delivery visibility global or scoped to an assigned recipient/customer? | Current API lists across all delivery rows; recipientId is merely a caller filter. `message`/recipientId metadata is exposed. | Operations + Data Protection |
| Q-06 | Is limit diagnostics authorization function-based (`limit.view`) or a type-based operational entitlement? | Admin UI uses `limit.view` and role grants exist, but controller/route/test contract allows OPERATOR/SERVICE/PRIVILEGED without function. | Finance/Operations + Security |
| Q-07 | If limit diagnostics is global, which roles and machine/service principals may query all customer/agent usage and reservation metadata? | Existing broad type allowlist can include service/privileged sessions whose human role mapping is not documented by test fixtures. | Finance/Operations |
| Q-08 | What is the canonical actor identity format for compliance history and evidence? | DTOs currently accept text `actor`/`uploadedBy`; audit integrity requires server-derived identity. | Compliance Operations + Security |
| Q-09 | Must denied reads be audited, and at what granularity? | Existing APIs may log authorizations differently; acceptance should avoid leaking denied resource existence while preserving required security audit. | Security + Audit |

## Default acceptance posture while unanswered

Deny by default at the backend; do not infer authorization from UI presence, role names without grants, principal type alone, or existing tests that encode old behavior. Hold current valid workflows that may be intended (e.g. SUPPORT delivery diagnostics) until policy owner clarifies; do not silently remove them or silently preserve broad access and claim security acceptance.
