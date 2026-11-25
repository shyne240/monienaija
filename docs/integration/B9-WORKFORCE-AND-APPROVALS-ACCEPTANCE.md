# Arena B9 — Workforce & Approvals acceptance

Base commit: `41edf587c262edafbd3eb2cc1b3042c614a9730e`
(`arena/5-main-web-integration`), branch `arena/b9a67ea6-monienaija`.

This record covers the Admin Web Workforce Access, Workforce Directory, Role Governance,
Approvals and Admin Recovery surfaces, the server controls they depend on, and the evidence that
both halves agree. Mobile is out of scope.

## What was delivered

| Area            | Surface                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approvals       | `ApprovalsScreen` + `ApprovalEvaluationInbox`       | Evaluation-first inbox: proposed change, affected record, required authority (approving roles, functions, minimum approvals, assurance), recorded decision history, and an explicit applied/not-applied state (`PENDING_DECISION`, `SELF_APPROVAL_BLOCKED`, `STALE`, `APPROVED_NOT_APPLIED`, `APPLIED`, `REJECTED`, `CANCELLED`, `UNKNOWN`). Rows can be loaded into the checker form, so the decision the operator reviews is the decision they submit. |
| Approvals       | `arena4-operations-api`                             | `approvals()` now returns `{items,total}` and `approval(id)` reads one authoritative approval, including the fail-closed `authority` block.                                                                                                                                                                                                                                                                                                              |
| Role governance | `RoleAssignmentScreen`                              | "Look up current access" resolves the target's real identity: current roles, effective permissions, institution restrictions, active sessions. A duplicate assignment is blocked before submission; the lookup feeds the governed form.                                                                                                                                                                                                                  |
| Workforce       | `WorkforceDirectoryScreen` → `RoleAssignmentScreen` | Inspecting an identity hands off to Role governance with the principal pre-filled.                                                                                                                                                                                                                                                                                                                                                                       |
| Workforce       | `Layout`                                            | **Product fix:** navigation cleared the hand-off prefill on _every_ view change, so the directory → governance hand-off never survived the transition. It is now cleared only when the destination is not Role governance.                                                                                                                                                                                                                               |
| Server          | `GET /internal/a2/workforce/approvals/:id`          | Authoritative single-approval read for the checker workspace. Visibility re-uses the list predicate (approval scope, approving roles, MFA, SUPER_ADMIN agent-funding exclusion); anything outside it — including an unknown id — is `404`, so the route is not an existence oracle.                                                                                                                                                                      |
| Server          | `authority` (fail-closed)                           | Approving roles, approving functions, minimum approvals, minimum assurance, approval scope, and `selfApprovalProhibited`, which is `true` unless a rule explicitly disables **both** self-approval and separation.                                                                                                                                                                                                                                       |

## Role access matrix

Two independent sources are recorded, and they agree:

- **Server-side:** `test/b9-workforce-approvals.integration.spec.ts` signs in each documented local
  account through the real `POST /internal/a2/workforce/local-admin-sessions` and asserts the
  session's scopes equal exactly the catalogue's live function grants ∪ the configured legacy
  scopes for that role — no more, no less.
- **Browser-side:** `scripts/admin-web-workforce-b9-browser.cjs` carries those same scope lists as
  fixtures, expands every nav section, enumerates every rendered nav item, and requires the set to
  equal the declared one. Nothing may appear that the role's scopes do not carry.

Rendered pages per role (browser, exhaustive DOM check) and the pages content-verified in the
browser:

| Role                  | Pages rendered | Content-verified                                                                   | Key grants                                                                                                               |
| --------------------- | -------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| SUPER_ADMIN           | 33             | dashboard, workforceAccess, workforceDirectory, roleGovernance, auditEvents        | `workforce.role.assign`, `workforce.role.view`, `privileged:execute`; **no** `privileged:approve` (cannot check)         |
| FINANCE_PREPARER      | 9              | dashboard, feeRules, ledgerExplorer                                                | maker only; no assignment or approval function                                                                           |
| FINANCE_CONTROLLER    | 13             | dashboard, approvalsInbox, feeRules, workforceDirectory                            | `privileged:approve`, `workforce.role.view`; no role governance                                                          |
| FINANCE_AUDITOR       | 26             | dashboard, auditEvents, workforceDirectory                                         | read-only `workforce.role.view`; no approve, no governance                                                               |
| ADMINISTRATOR         | 10             | dashboard, workforceAccess, workforceDirectory, roleGovernance, superAdminRecovery | `workforce.role.view`, `workforce.role.assign_operational`, `workforce.super_admin.recover`; **no** `privileged:approve` |
| OPERATIONS            | 13             | dashboard, customers, workforceAccess                                              | no `workforce.role.view` → directory is `403` server-side                                                                |
| AGENT_NETWORK_MANAGER | 6              | dashboard, agents                                                                  | no workforce grants                                                                                                      |
| COMPLIANCE            | 8              | dashboard, kycQueue                                                                | no workforce grants                                                                                                      |
| RISK_FRAUD            | 2              | dashboard, fraudCases                                                              | no workforce grants                                                                                                      |
| CUSTOMER_SERVICE      | 4              | dashboard, customers                                                               | no workforce grants                                                                                                      |
| TREASURY              | 3              | dashboard, reconciliation                                                          | no `workforce.role.view`, no `privileged:approve`                                                                        |

Pages outside Arena B9 (money movement, KYC operations, catalogue administration) are rendered but
not clicked, because their endpoints are not modelled by the fixture API and a failure there would
be an artefact of the fixture, not an observation about access control. They are still covered by
the exhaustive DOM check above.

A rejected credential leaves the operator on the login screen, and an unauthenticated directory
read is `401`.

## Maker-checker, end to end (real PostgreSQL + real HTTP)

`test/b9-workforce-approvals.integration.spec.ts` — 17/17 — runs the real `AppModule` against an
embedded disposable PostgreSQL, authenticates through real endpoints, and proves:

1. The maker (SUPER_ADMIN) requests `FINANCE_ROLE_ASSIGN`. The action fingerprint is computed by the
   production service, so the request is the request the consuming domain will verify.
2. The maker cannot approve its own request (`403`, authorization denied), and the maker's list does
   not contain the row — the maker is not an approving role.
3. TREASURY sees zero approvals and gets `404` for the id; an unknown id is also `404`.
4. The checker (FINANCE_CONTROLLER) sees the row with `authority = {approvingRoles:
['FINANCE_CONTROLLER'], minimumApprovals: 1, selfApprovalProhibited: true, minimumAssurance:
'MFA', approvalScope: 'privileged:approve', governed: false}` and approves it.
5. Assigning **before** the decision is refused; assigning **with** the decision succeeds, and the
   approval becomes `CONSUMED` — exactly once. Replaying the same approval is refused (`403`).
6. The directory then shows the new `FINANCE_AUDITOR` assignment alongside `FINANCE_PREPARER`, with
   effective permissions and `institutionScope.mode = NONE` (absence of institution scope is never
   reported as platform-wide reach), and omits it from the `FINANCE_AUDITOR`-filtered page.
7. A checker that raised a decision itself is refused by `decide()` with `SELF_APPROVAL_FORBIDDEN`,
   even holding every grant, and the row stays `REQUESTED` with `approvedBy = null`.
8. A principal cannot change its own access; OPERATIONS is refused the directory (`403`) and the
   role surface (`403`); `SUPER_ADMIN` cannot be granted through the workforce role surface.

Supported recovery is proven separately in the disposable environment:
`test/v1-security-super-admin-recovery-01.integration.spec.ts` — 18/18, real PostgreSQL, ephemeral
in-process keys only (replay, concurrency, wrong environment/target/purpose, non-ADMINISTRATOR
caller, self-authorization, fabricated statement, missing crypto config, mandatory MFA, no private
key material in generator output).

## Configurable workforce roles (revised V1 scope, PR #26)

The revision asks for roles an authorized administrator can define, not a fixed list. The
governance API for this already existed (`role-definition-governance.controller.ts`); what was
missing was the last mile — a role defined and applied to the catalogue could never be **assigned**,
and the approval a role change consumes could not be obtained by a client.

### What changed

| Change                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `assign()` routes custom catalogue roles (active, not one of the eleven seeded roles) through the maker/checker path instead of the first-assignment bootstrap allow-list | A newly applied role has zero active assignments, so it was treated as a bootstrap grant and refused as "Initial Finance role assignment denied". A custom role now always requires an independent checker, exactly like a later grant of a seeded role.                                                                                                           |
| `POST /internal/a2/workforce/roles/approval-requests`                                                                                                                     | Creates the approval a governed role change consumes, with the fingerprint computed by the same service method the assignment verifies. The Admin Web no longer asks operators to paste ids they could not derive.                                                                                                                                                 |
| `GET /internal/a2/workforce/role-definitions/functions`                                                                                                                   | The catalogue the editor may choose from: assignable functions only, never `workforce.role.*`, never finance-class restricted. The picker and the apply validation now agree by construction.                                                                                                                                                                      |
| Admin Web `RoleDefinitionsPanel`                                                                                                                                          | Define (role key, display name, description, read-only, function selection from the catalogue, reason), then approve/reject (independent checker) and apply (initiator). States are explicit: awaiting approval, approved-not-applied, applied, rejected, expired, failed. Loaded on demand so a role that only reads assignments generates no definition traffic. |
| Admin Web role-change form                                                                                                                                                | Custom role key field for an applied configurable role, and a "Prepare approval on the server" action that fills the approval id the change will consume.                                                                                                                                                                                                          |

Controls preserved: definitions can only be initiated by `SUPER_ADMIN` (`workforce.role.create`)
and decided by an independent `FINANCE_CONTROLLER`; the proposer cannot decide its own proposal;
every step requires MFA; seeded roles cannot be modified through the workflow (`isSystemSeeded`);
`workforce.role.*` functions can never be granted to a configurable role, so a custom role cannot
escalate its own authority; `SUPER_ADMIN` assignment/revocation stays prohibited; recovery is
untouched (its own 18/18 disposable-environment suite still passes).

### End-to-end evidence (real PostgreSQL, real workforce sign-in)

`test/b9-custom-role.integration.spec.ts` — **16/16** — defines `SOC_ANALYST` with
`fee_rule.view` and `audit.search`, and proves, in order:

1. The target account cannot sign in before any grant (`401 No valid workforce roles`).
2. The catalogue endpoint offers assignable functions only (no `workforce.role.*`).
3. `SUPER_ADMIN` submits the definition; the proposer is refused (`403`) when it tries to approve.
4. Applying before approval is refused (`409`); `FINANCE_CONTROLLER` approves; `SUPER_ADMIN` applies; the catalogued role is active, non-seeded and read-only.
5. Assigning without an approval is refused (`403`); the server prepares the assignment approval; the maker cannot decide it; the checker approves; the assignment succeeds with scopes exactly `audit.search` + `fee_rule.view`.
6. The user signs in with exactly that role and its grants.
7. **Granted action:** `GET /internal/fee-rules` returns `200`.
8. **Denied actions:** `GET /internal/workforce/directory` is `403`; `POST /internal/fee-rules` is `403`.
9. **Effective permissions and institution scope:** the directory reports the role, the read-only flag, the two effective permissions and an `INSTITUTIONS` scope binding to the registered institution.
10. **Revocation:** prepared approval → checker decision → `DELETE …/roles/:principalId/:roleKey` returns `REVOKED`; the _same_ session token immediately gets `401` on the previously granted route; re-sign-in fails; the definition remains active with no active assignment.
11. **Regression:** all eleven local accounts still sign in with their original roles.

### Browser evidence

The harness now also drives a custom-role session (`SOC_ANALYST`, grants `fee_rule.view` +
`audit.search`) and the definition workspace. Checks added on top of the 27:

| Check                            | What it shows                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `CUSTOM-ROLE-MENU`               | The sidebar contains exactly Dashboard, Fee rules and Audit events — the two granted destinations and the ungated landing page. |
| `CUSTOM-ROLE-DENIED-PAGES`       | Approvals, Role governance, Admin recovery, Workforce access and Workforce directory are absent.                                |
| `CUSTOM-ROLE-GRANTED-PAGE`       | Fee rules renders and issues its authorized read with the custom session's token.                                               |
| `ROLE-DEFINITION-CATALOGUE`      | Opening the definitions workspace loads the function catalogue (4 assignable options in the fixture, not a fixed list).         |
| `ROLE-DEFINITION-SUBMITTED`      | The submitted body carries `SOC_ANALYST` and exactly two `VIEW` grants.                                                         |
| `ROLE-DEFINITION-AWAITS-CHECKER` | The new definition is listed as awaiting independent approval, with its functions.                                              |

Total browser checks: **33/33**.

## Known gaps and blockers

1. **Role changes consume the `FINANCE_ROLE_ASSIGN` / `FINANCE_ROLE_REVOKE` rule.**
   `governed-action.registry.ts` still has no `WORKFORCE_ROLE_ASSIGN` / `WORKFORCE_ROLE_REVOKE`
   entries, so a custom-role change is governed by the environment's Finance role rule
   (SUPER_ADMIN initiates, FINANCE_CONTROLLER checks). It works and is enforced server-side — the
   prepare route returns the exact action and fingerprint — but the policy is named for Finance
   roles, and `ADMINISTRATOR` cannot author or assign configurable roles (only `SUPER_ADMIN` holds
   `workforce.role.create` / `workforce.role.assign`). Extending the registry is a policy decision,
   not a code gap that can be closed unilaterally.
2. **Browser evidence uses a fixture API.** The harness intercepts `**/api/v1/**` at the browser
   network layer. It proves client behaviour, state handling and navigation, not server enforcement;
   server enforcement is the real-PostgreSQL suite above. A single harness that drives the real API
   end to end is still absent.
3. **No standalone dev server locally.** `FINANCIAL_DEPENDENCY_BLOCKERS` (8, no override) make
   `dist/main.js` refuse to boot, so browser runs are served from a static bundle and the API is
   stubbed or driven in-process by Jest.
4. **No OIDC identity provider locally.** Only the local-admin password path exists
   (`local-admin-sessions`); the real OIDC exchange is covered by unit/integration tests with
   synthetic assertions, not by the browser run.
5. **`ADMINISTRATOR` holds `workforce.role.view`.** This is the deployment's actual catalogue grant,
   so it reads the directory (read-only) in addition to governing operational roles. Earlier browser
   fixtures under-declared this scope; the matrix above is now server-derived.
6. **Pre-existing formatting drift** in four untouched Admin Web files
   (`PremblyCredentialSettings.tsx`, `CommercialAuthoringDrawer.tsx`, `CommercialPreviewPanel.tsx`,
   `banking-admin-api.ts`). Not modified here.

## Reproduction

```bash
# Admin Web unit/type checks
cd apps/admin-web && npx jest --watchAll=false && npx tsc --noEmit

# Real PostgreSQL + real HTTP (disposable embedded cluster)
node start-pg-temp.js &
NODE_ENV=test PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes PG_TEST_RUN_ID=b9run01 \
LOCAL_DEV_SEED_CONFIRM=disposable-local-database \
  npx jest --config jest.integration.config.js \
  --runTestsByPath test/b9-workforce-approvals.integration.spec.ts

# Configurable role, end to end (real PostgreSQL + real HTTP, real sign-in)
NODE_ENV=test PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes PG_TEST_RUN_ID=b9run01 \
LOCAL_DEV_SEED_CONFIRM=disposable-local-database \
  npx jest --config jest.integration.config.js \
  --runTestsByPath test/b9-custom-role.integration.spec.ts

# Browser acceptance (production bundle, fixture API)
cd apps/admin-web && ADMIN_WEB_API_BASE_URL=/api/v1 \
  npx vite build --outDir /tmp/b9-dist --emptyOutDir && cd ..
LD_LIBRARY_PATH=/tmp/al2023/lib node scripts/admin-web-workforce-b9-browser.cjs \
  --dist /tmp/b9-dist --out docs/integration/evidence/b9-workforce-approvals \
  --executable /tmp/chromium
```

The browser run writes `report.md`, `report.json` and four 1440×1000 screenshots into
`docs/integration/evidence/b9-workforce-approvals/`.

## Results

| Suite                                          | Result                           |
| ---------------------------------------------- | -------------------------------- |
| Admin Web Jest                                 | **100 suites / 1032 tests pass** |
| Admin Web `tsc --noEmit`                       | clean                            |
| Browser acceptance                             | **33/33** checks pass            |
| B9 real-PG/HTTP acceptance (approvals)         | 17/17                            |
| B9 real-PG/HTTP acceptance (configurable role) | **16/16**                        |
| Super-admin recovery (real PG)                 | 18/18                            |
| Backend targeted unit specs                    | 312 pass across 9 specs          |
| Backend `tsc -p tsconfig.build.json`           | clean                            |
