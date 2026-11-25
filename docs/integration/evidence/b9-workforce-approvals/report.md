# Arena B9 — Workforce & Approvals browser acceptance

Generated: 2026-11-25T12:43:59.282Z
Browser: 153.0.8010.0 · viewport 1440x1000
API: fixture (route-intercepted at the browser network layer)

33/33 checks passed.

| Check | Result | Evidence |
| --- | --- | --- |
| `SIGN-IN-SUPER_ADMIN` | PASS | super-admin@monienaija.local · verified=[dashboard, workforceAccess, workforceDirectory, roleGovernance, auditEvents] of 33 rendered · problems=[] · navChars=299 |
| `SIGN-IN-FINANCE_PREPARER` | PASS | finance-preparer@monienaija.local · verified=[dashboard, feeRules, ledgerExplorer] of 9 rendered · problems=[] · navChars=174 |
| `SIGN-IN-FINANCE_CONTROLLER` | PASS | finance-controller@monienaija.local · verified=[dashboard, approvalsInbox, feeRules, workforceDirectory] of 13 rendered · problems=[] · navChars=173 |
| `SIGN-IN-FINANCE_AUDITOR` | PASS | finance-auditor@monienaija.local · verified=[dashboard, auditEvents, workforceDirectory] of 26 rendered · problems=[] · navChars=266 |
| `SIGN-IN-ADMINISTRATOR` | PASS | administrator@monienaija.local · verified=[dashboard, workforceAccess, workforceDirectory, roleGovernance, superAdminRecovery] of 10 rendered · problems=[] · navChars=151 |
| `SIGN-IN-OPERATIONS` | PASS | operations@monienaija.local · verified=[dashboard, customers, workforceAccess] of 13 rendered · problems=[] · navChars=182 |
| `SIGN-IN-AGENT_NETWORK_MANAGER` | PASS | agent-network-manager@monienaija.local · verified=[dashboard, agents] of 6 rendered · problems=[] · navChars=136 |
| `SIGN-IN-COMPLIANCE` | PASS | compliance@monienaija.local · verified=[dashboard, kycQueue] of 8 rendered · problems=[] · navChars=162 |
| `SIGN-IN-RISK_FRAUD` | PASS | risk-fraud@monienaija.local · verified=[dashboard, fraudCases] of 2 rendered · problems=[] · navChars=77 |
| `SIGN-IN-CUSTOMER_SERVICE` | PASS | customer-service@monienaija.local · verified=[dashboard, customers] of 4 rendered · problems=[] · navChars=107 |
| `SIGN-IN-TREASURY` | PASS | treasury@monienaija.local · verified=[dashboard, reconciliation] of 3 rendered · problems=[] · navChars=89 |
| `CUSTOM-ROLE-MENU` | PASS | soc-analyst@monienaija.local · nav=[auditEvents, dashboard, feeRules] |
| `CUSTOM-ROLE-DENIED-PAGES` | PASS | denied menu entries that appeared: [] |
| `CUSTOM-ROLE-GRANTED-PAGE` | PASS | Fee rules rendered for the custom role and issued 1 authorized read(s) |
| `ROLE-DEFINITION-CATALOGUE` | PASS | function options=4 (server catalogue, not a fixed list) |
| `ROLE-DEFINITION-SUBMITTED` | PASS | POST role-definitions/proposals body={"proposalType":"CREATE","roleKey":"SOC_ANALYST","displayName":"SOC Analyst","description":"Read-only commercial and audit visibility for the security operations centre.","readOnly":true,"functionGrants":[{"functionCode" |
| `ROLE-DEFINITION-AWAITS-CHECKER` | PASS | SOC_ANALYST Awaiting independent approval SOC Analyst · CREATE · read-only Functions: fee_rule.view (VIEW), audit.search (VIEW) Requested 2026-11-25T10:00:00.000Z · expires 2026-11-25T11:00:00.000Z Aw |
| `SIGN-IN-REJECTED` | PASS | a rejected credential leaves the operator on the login screen |
| `APPROVALS-INBOX-RENDERS` | PASS | rows=3 |
| `APPROVALS-INBOX-PROPOSED-CHANGE` | PASS | affected record and required approving role are on the row |
| `APPROVALS-EVALUATION-DETAIL` | PASS | proposed change, affected record, required authority and decision history are shown |
| `APPROVALS-LOAD-INTO-CHECKER` | PASS | checker field value=11111111-1111-4111-8111-111111111111 |
| `APPROVALS-REVIEW-DIALOG` | PASS | confirmation dialog names the approval id before any write |
| `APPROVALS-DECISION-SUBMITTED` | PASS | POST /api/v1/internal/a2/workforce/approvals/11111111-1111-4111-8111-111111111111/approve body={"comment":"Verified against the approved fee schedule."} |
| `APPROVALS-RECEIPT-SHOWN` | PASS | Approval recorded. The underlying action may require a separate execution step. Approval ID: 11111111-1111-4111-8111-111111111111 |
| `APPROVALS-STATE-VOCABULARY` | PASS | approved-not-applied, applied, rejected and stale are each stated |
| `APPROVALS-SELF-APPROVAL-BLOCKED` | PASS | the checker cannot load their own request for a decision |
| `DIRECTORY-IDENTITY-VISIBLE` | PASS | roles, effective permissions and institution restrictions are shown for the identity |
| `DIRECTORY-TO-GOVERNANCE-HANDOFF` | PASS | Role governance opens with the inspected principal, its current roles and institution scope |
| `GOVERNANCE-BLOCKS-DUPLICATE` | PASS | a duplicate assignment is blocked once current roles are verified |
| `GOVERNANCE-DRAFT-LEAVE-GUARD` | PASS | leaving a prepared role change required an explicit discard confirmation |
| `RECOVERY-RENDERS-WITHOUT-WRITE` | PASS | recovery workspace opened with no recovery request sent |
| `NO-UNEXPECTED-PAGE-ERRORS` | PASS | pageErrors=none · console=none |

Screenshots in this directory: `b9-approvals-inbox-1440x1000.png`,
`b9-workforce-directory-1440x1000.png`, `b9-role-governance-1440x1000.png`,
`b9-super-admin-recovery-1440x1000.png`, `b9-role-definitions-1440x1000.png`.

Client behaviour only. Server maker-checker, role, institution, MFA and recovery controls are covered by the Nest HTTP and PostgreSQL suites.
