# MonieNaija Admin Web audit and proposed V1 scope

Baseline: merged Arena integration commit `41edf587c262edafbd3eb2cc1b3042c614a9730e`. This scope proposal accounts for all 36 sidebar destinations declared in the baseline, including legacy entries slated for consolidation. Browser inspection and repository evidence establish the current surface. Workflow acceptance and production readiness require the evidence listed below. Open PRs are candidate changes.

## Scope by operator workflow

| Area | Baseline destinations | Proposed V1 outcome and evidence needed |
| --- | --- | --- |
| Overview | Dashboard, Dashboard Settings | Staff see authorized operational metrics and can drill into the relevant records. Verify role-specific layouts and settings, unavailable data, and permission enforcement on the underlying reads. |
| Customer servicing | Customers, Customer classes | Staff can register and service customers in Customer 360. The web milestone is ready to claim on mobile. Provision an approved default class per verified tier and show effective product fees and limits. On a disposable database, verify Tier 1–3, missing-configuration handling, tier changes, and the handoff to the existing OTP, BVN, passcode and PIN claim flow. The baseline uses one global Standard default. Draft #24 proposes per-tier defaults. |
| Agent operations | Agents & network, Agent classes | Staff can draft, review and activate applications, manage eligible services, and see class pricing, commission and limits before activation. Verify class assignment and the runtime effect of a class change. |
| Support | Support Inbox | Search, assign, update and resolve a customer or agent ticket with permitted access to case history. |
| Institutions | Institution directory | Review registration, evidence, authorizations, operational state and related settings in the linked institution workspace. Verify scoped access and permitted state changes. |
| Transaction operations | Transfers, Deposits, Withdrawals, Cash to cash | Consolidate these entries into Transaction History. Verify reference, Lagos date, status and type filters, predictable paging and scoped detail. Use product names, including Cash to Wallet and Wallet to Cash. Preserve cash-to-cash lifecycle on the parent transaction. Draft #23 covers four types. |
| Finance | Ledger & reversals, Reconciliation, Banking operations | Search by business reference and date, follow links both ways between history and journals, carry out governed reversals, and investigate reconciliation breaks and bank exceptions. Finance PR #25 adds operator surfaces. Verify it together with #23 using real workforce sessions. Missing external evidence stays unavailable. |
| Commercial policy | Fee rules, Commission rules, Reward rules, Products, Limit catalogue, Limit assignments | Configure and approve supported products, rates and limits, view what an operator can change, and preview actual runtime behavior. A reward registry alone does not establish wallet reward crediting. Verify publication, assignment and runtime effects per product. |
| Risk and compliance | KYC reviews, KYC providers, KYC tier policies, Compliance cases, Fraud cases | Support evidence review, provider readiness and routing, approved policy versions, cases and permitted decisions. Confirm Monnify BVN/NIN and Dojah address routing against configured paths and document Prembly's role. Drafts #18/#22 are candidate changes. The local baseline had no published KYC policy. |
| Workforce governance | Workforce access, Role governance, Approvals, Admin recovery, Workforce directory | Manage workforce users, roles, function grants and institution scope. Prove custom role creation, independent approval, application, assignment, effective menus and API permissions, and revocation. Verify recovery separately in a disposable setup. |
| System operations | Notifications, System health, Audit events, Notification operations, Audit inspection | Configure permitted notification behavior, investigate delivery, inspect health and follow audit evidence. Verify sensitive-data boundaries and retained details using a known operation. |

## Transaction products and release evidence

The seven original catalogue products are Wallet Transfer, Cash to Wallet, Wallet to Cash, Cash to Cash, Customer Funding, Agent Funding and Agent Defunding. Add Wallet to Bank and Bank to Wallet to the proposed release scope. The branch includes agent outbound execution and inbound virtual-account and webhook handling. Verify customer outbound execution, inbound wallet credit and settlement before marking either bank direction release-ready. Integrate funding and banking in Transaction History using authoritative source records and durable institution attribution.

BVN, NIN and address verification, approved KYC tier policy, staff-to-mobile claim, configurable workforce authorization, institution operations and financial investigation belong in the updated Admin Web scope. Old product seed exclusions alone should not decide these items. Provider activation, external settlement and policy amounts require their own evidence and approval.

## Roles and functions

The existing eleven local roles and credentials are regression fixtures. The backend has governed role-definition proposal endpoints for custom roles with function grants. The baseline Role Governance UI builds its assignment dropdown from fixed lists and does not expose a full role-definition editor. The existing assignment service routes named operational roles separately and restricts first assignments to a fixed bootstrap allowlist. Creating a custom definition therefore does not supply a supported first assignment through this path. Fix both the assignment backend and the UI under the approved role policy. A release test needs an independently approved custom role, effective function grants on a workforce user, a permitted route and menu, a denied route, and revocation. Preserve all fixture credentials.

## Open integration work and acceptance

- #23 Transaction History needs remaining products, production-like workforce-session evidence and authorization review.
- #24 Customer defaults needs actual browser and migrated-database proof of staff-to-mobile handoff and effective ceilings.
- #25 Finance needs green CI at the reviewed head and the combined transaction-to-journal workflow with #23.
- #18 and #22 overlap on identity verification. Confirm the intended provider path and the surviving PR before counting either as delivered.
- #9 is an older customer-class draft. Reconcile overlap with #24 before adopting it.
- A menu-render or sign-in check proves availability for the observed session. It does not prove a mutation, reviewer decision, external provider call or ledger posting. Complete those acceptance checks on a fully migrated disposable environment, then repeat cross-package tests on the merged candidate.

## Historical references

- [Earlier Admin Web audit](V1-ADMIN-FULL-SURFACE-AUDIT-01-REPORT.md)
- [Earlier V1 scope reassessment](V1-SCOPE-CHALLENGE-01.md)
- [Consolidated application handoff](../integration/MONIENAIJA-V1-CONSOLIDATED-TRANSACTION-AND-APPLICATION-HANDOFF.md)
- [Current navigation](../../apps/admin-web/src/screens/authenticated/Layout.tsx)
- [Role assignment UI](../../apps/admin-web/src/screens/authenticated/RoleAssignmentScreen.tsx)
- [Role-definition governance API](../../src/authorization/role-definition-governance.controller.ts)


## Live browser role baseline

All 11 existing local accounts signed in successfully. Their combined navigation exposed all 36 declared destinations. Each destination was opened in Edge under a role that could see it, and its workspace heading rendered. This was a read-only browser pass. Approvals appeared for Finance Controller, Admin Recovery for Administrator, and Fraud Cases for Risk Fraud. Those three destinations were absent in the Super Admin session. These observations describe the baseline grants and should not be treated as an exhaustive policy specification.

| Local role | Visible sidebar destinations |
| --- | --- |
| SUPER_ADMIN | Dashboard, Dashboard Settings, Customers, Customer classes, Agents & network, Agent classes, Support Inbox, Institution directory, Transfers, Deposits, Withdrawals, Cash to cash, Ledger & reversals, Reconciliation, Banking operations, Fee rules, Commission rules, Reward rules, Products, Limit catalogue, Limit assignments, KYC reviews, KYC providers, KYC tier policies, Compliance cases, Workforce access, Role governance, Notifications, System health, Audit events, Notification operations, Workforce directory, Audit inspection |
| FINANCE_PREPARER | Dashboard, Institution directory, Ledger & reversals, Fee rules, Commission rules, Reward rules, Products, Limit catalogue, Limit assignments |
| FINANCE_CONTROLLER | Dashboard, Agents & network, Institution directory, Ledger & reversals, Fee rules, Commission rules, Reward rules, Products, Limit catalogue, Limit assignments, Approvals, Notifications, Workforce directory |
| FINANCE_AUDITOR | Dashboard, Customers, Customer classes, Agents & network, Agent classes, Institution directory, Transfers, Deposits, Withdrawals, Cash to cash, Ledger & reversals, Reconciliation, Banking operations, Fee rules, Commission rules, Reward rules, Products, Limit catalogue, Limit assignments, KYC reviews, Notifications, System health, Audit events, Notification operations, Workforce directory, Audit inspection |
| ADMINISTRATOR | Dashboard, Dashboard Settings, Customers, Customer classes, Agents & network, Agent classes, Workforce access, Role governance, Admin recovery, Workforce directory |
| OPERATIONS | Dashboard, Customers, Customer classes, Support Inbox, Institution directory, Transfers, Deposits, Withdrawals, Cash to cash, Workforce access, Notifications, System health, Notification operations |
| AGENT_NETWORK_MANAGER | Dashboard, Agents & network, Agent classes, Institution directory, Limit catalogue, Limit assignments |
| COMPLIANCE | Dashboard, Customers, Customer classes, Institution directory, KYC reviews, KYC providers, KYC tier policies, Compliance cases |
| RISK_FRAUD | Dashboard, Fraud cases |
| CUSTOMER_SERVICE | Dashboard, Customers, Customer classes, Support Inbox |
| TREASURY | Dashboard, Reconciliation, Banking operations |
