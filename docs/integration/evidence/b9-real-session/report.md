# Arena B9 — configurable role, real workforce sessions, real PostgreSQL

Generated: 2026-11-25T12:58:48.401Z
Admin Web bundle served at http://127.0.0.1:4401; `/api/v1` proxied to the real Nest application.
Database: disposable PostgreSQL, fully migrated, eleven local fixture accounts seeded.

22/22 checks passed.

| Check | Result | Evidence |
| --- | --- | --- |
| `DEFINITION-CATALOGUE-FROM-API` | PASS | the editor loaded 93 assignable catalogue functions from the real API |
| `DEFINITION-SUBMITTED` | PASS | SOC_ANALYST Awaiting independent approval SOC Analyst · CREATE · read-only Functions: customer.view (VIEW), fee_rule.view (VIEW) Requested 2026-11-25T12:58:10.469Z · expires 2026-11-25T13:13:10.469Z Awaiting an independe |
| `DEFINITION-SELF-APPROVAL-UNAVAILABLE` | PASS | decision controls offered to the proposer: 0 |
| `DEFINITION-CHECKER-WORKSPACE` | PASS | the checker can open the definition but not the assignment form |
| `DEFINITION-APPROVED` | PASS | POST /api/v1/internal/a2/workforce/role-definitions/proposals/d463696f-5f65-460f-9700-c2623b221611/approve -> 201; card="SOC_ANALYST Approved — not yet applied SOC Analyst · CREATE · read-only Functions: customer.view (VIEW), fee_rule.view (" |
| `DEFINITION-APPLIED` | PASS | the approved definition was applied to the catalogue |
| `ASSIGNMENT-APPROVAL-PREPARED` | PASS | Approval 45f37eae-5cd8-4715-bab0-126d7df00951 prepared (FINANCE_ROLE_ASSIGN) for a2-fin-role-e322957fed38a1d617ff01c5bbbdd299. An independent checker must decide it before this change can be applied. |
| `ASSIGNMENT-APPROVAL-DECIDED` | PASS | POST /approvals/45f37eae-5cd8-4715-bab0-126d7df00951/approve -> 201 |
| `ASSIGNMENT-APPLIED` | PASS | POST /internal/a2/workforce/roles -> 201 |
| `CUSTOM-ROLE-SIGNED-IN` | PASS | roles=[SOC_ANALYST] scopes=[customer.view,fee_rule.view] |
| `CUSTOM-ROLE-GRANTED-MENUS` | PASS | sidebar=[customerClasses, customers, dashboard, feeRules] |
| `CUSTOM-ROLE-DENIED-MENU` | PASS | Workforce directory and Role governance are absent from the sidebar |
| `CUSTOM-ROLE-GRANTED-PAGE` | PASS | the granted Fee rules workspace rendered for the custom role |
| `CUSTOM-ROLE-GRANTED-READS` | PASS | GET fee-rules=200 customers=200 |
| `CUSTOM-ROLE-DENIED-API` | PASS | GET workforce/directory=403 role-definitions/proposals=403 |
| `REVOCATION-APPROVAL-PREPARED` | PASS | Approval ec10e836-e227-46d6-9681-498744c2faf4 prepared (FINANCE_ROLE_REVOKE) for a2-fin-role-e322957fed38a1d617ff01c5bbbdd299. An independent checker must decide it before this change can be applied. |
| `REVOCATION-APPROVED` | PASS | POST /approvals/ec10e836-e227-46d6-9681-498744c2faf4/approve -> 201 |
| `REVOCATION-APPLIED` | PASS | DELETE /api/v1/internal/a2/workforce/roles/https%3A%2F%2Fidp.example.com%3Alocal-admin-credential%3A32a8f2573da2952e8504c9e9a978c60f/SOC_ANALYST -> 200 |
| `ACCESS-LOST-IMMEDIATELY` | PASS | the same token that read fee rules returned 401 after the revocation |
| `SESSION-INVALIDATED-IN-UI` | PASS | reloading the analyst workspace returned the operator to the login screen |
| `ELEVEN-FIXTURES-UNCHANGED` | PASS | failures=0 |
| `NO-UNEXPECTED-PAGE-ERRORS` | PASS | none |

Screenshots in this directory: `definition-submitted-1440x1000.png`,
`definition-approved-1440x1000.png`, `definition-applied-1440x1000.png`,
`assignment-applied-1440x1000.png`, `custom-role-granted-1440x1000.png`,
`after-revocation-1440x1000.png`.
