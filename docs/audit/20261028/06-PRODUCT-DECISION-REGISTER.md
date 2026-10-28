# 06 — Product and Governance Decision Register

This register is limited to unresolved decisions relevant to backend/Admin completion. It does not reopen settled product decisions.

| ID | Decision required | Current source posture | Owner / gating work |
|---|---|---|---|
| D-01 | Exact workforce roles/functions allowed to access customer compliance cases and each subresource | Controller has no dedicated function check; generic route policy permits multiple workforce types | Product + Security; gates P0-01 and case UI |
| D-02 | Whether notification delivery diagnostics require `notification.view_deliveries` or another narrower scope, and which workforce roles hold it | UI checks a function; delivery-list controller only checks workforce principal type; provider and test-send routes independently enforce functions | Product + Security; gates P0-02 |
| D-03 | Whether limit usage/reservation diagnostics are intentionally available to all allowed workforce principal types or only `limit.view` holders | Backend workforce type gate differs from Admin scope gate | Product + Security; gates P0-03 |
| D-04 | Intended per-category case visibility and server-side fraud taxonomy | Current fraud category filter is frontend-only | Compliance product + Security; gates P1-01 |
| D-05 | Whether reward registry is configuration-only for V1 or approved runtime reward posting is required | Existing policy says registry does not establish runtime crediting | Product + Finance; gates P1-04 |
| D-06 | Whether Admin needs a general discoverable pending-approval queue | Current generic page is ID lookup; funding approval queues are separate | Operations/product; gates P1-07 |
| D-07 | Workforce user enable/reactivation authority and function code | Admin intentionally omits enable at an authorization catalogue boundary | Security/Product; P2-02 |
| D-08 | Whether Dashboard Settings includes template authoring or only role assignment | Source supports assignment, not full template authoring | Product; P2-03 |
| D-09 | Support inbox V1 status/assignment/escalation lifecycle | Existing screen covers selected ticket operations; full CRM requirement not established | Support/product owner; P2-01 |
| D-10 | Ratify/replace interim notification maker-checker policy | Closure report documents maker SUPER_ADMIN + MFA and checker FINANCE_CONTROLLER + MFA; explicitly pending ratification | Product/Finance/Security; P1-06 prerequisite |
| D-11 | Operational ownership, intended environments, enablement and alerting for C2C expiry worker | Code exists but flag default false; no transition to automatic fund disposition is allowed by this audit | Operations/Finance; P1-05 |
| D-12 | Production notification/email provider activation readiness | Existing dark-launch posture: worker/config/provider prerequisites and sign-off; no live activation in audit | Product/Operations; release checklist only |

## Preserved decisions — not reopened

- Backend/Admin Web completion comes before mobile UX work.
- SMS/email templates remain configurable, not hardcoded.
- C2C beneficiary content may include verified sender name, committed amount and locator link; never transfer credentials.
- Unregistered beneficiaries are supported; the agent notification inbox is approved.
- Agent onboarding is required through Admin Web and Agent Mobile; backend/Admin first.
- No automatic disposition of expired C2C funds absent explicit decision.
- Sensitive notification changes need independent approval and MFA.
- Manual notification retry is deferred from V1.
- Customer-facing notifications are not activated in production by this audit; no mobile UI or unrelated frontend changes.

## Decision discipline

A decision to expose an action must be paired with server-side permissions, audit and negative tests. A decision to defer closes only the scope question; it does not make the existing code complete or production-ready. The audit itself makes no product or financial-policy decisions.
