# Arena 4 — Administrative Governance and Operations V2

Run date: 2026-11-22. Baseline: `arena/5-main-web-integration`
@ `bde9f8ff921c4ca8cf2eefb0e795cf530b9b2793` (contains merged Arena 5 PR #8).

This document is the mission's governance coverage matrix, the implementation record for the
administration surfaces it adds, and the list of remaining blockers. It deliberately does **not**
introduce policy: every row cites an already-approved function code, role assignment, maker/checker
rule or route policy that exists in the repository at the baseline commit.

Scope statement (what this mission is and is not):

- **Is** administrative visibility and inspection over infrastructure that already exists —
  notification delivery evidence, workforce grant evidence, and the append-only audit store.
- **Is not** a notification engine, a role-granting workflow, a new catalogue, or a policy change.
  Where an approved policy does not exist (manual delivery retry, unrestricted role grant, KYC
  evidence exposure), the surface reports the gap instead of implementing a private rule.

---

## 1. Governance coverage matrix

Legend for **Implementation status**:

- **Existing** — capability was present at the baseline; this mission did not change its behaviour.
- **Added (read-only)** — surface added by this mission, projection only, no write route.
- **Blocked** — no approved policy exists; the surface states the gap rather than implementing it.

### 1.1 Customer administration

| Action / resource                            | Governing functions                                                                                           | Permitted roles (catalogue seed)                                                                  | Maker/checker                                                                                                                 | MFA                               | Institution scope                                                                                          | Audit requirement                                                                | Status                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| View customer profile / status               | `customer.view`                                                                                               | `SUPER_ADMIN`, `ADMINISTRATOR`, `OPERATIONS`, `FINANCE_AUDITOR`, `COMPLIANCE`, `CUSTOMER_SERVICE` | No                                                                                                                            | Route default (workforce session) | Institution-scoped customers only via institution attribution (Arena 4 Phase 2)                            | Authorization decision recorded on deny; operational reads via `/internal/audit` | Existing                                                              |
| Create / activate / suspend / close customer | `customer.create`, `customer.activate`, `customer.suspend`, `customer.close`                                  | `SUPER_ADMIN`, `OPERATIONS`                                                                       | No (single-actor operational action)                                                                                          | Workforce session                 | Institution-affiliated customers require the institution attribution path                                  | `AUDIT` on state change                                                          | Existing                                                              |
| Wallet creation                              | `customer.create_wallet`                                                                                      | `SUPER_ADMIN`, `OPERATIONS`                                                                       | No                                                                                                                            | Workforce session                 | Wallet institution attribution governed separately (`WALLET_INSTITUTION_ATTRIBUTION`, protected authority) | `AUDIT` on wallet creation                                                       | Existing                                                              |
| KYC review / decision                        | `kyc.view`, `kyc.review`, `kyc.approve`, `kyc.reject`                                                         | `SUPER_ADMIN`, `COMPLIANCE`                                                                       | No — but KYC policy and provider changes are maker/checker (`kyc.policy.propose`/`approve`, `kyc.provider.propose`/`approve`) | Workforce session                 | None                                                                                                       | `AUDIT` per review decision                                                      | Existing                                                              |
| KYC evidence access                          | `customer.view_identity_documents`, `customer.download_proof_of_address`, `customer.archive_proof_of_address` | `SUPER_ADMIN`, `COMPLIANCE`                                                                       | No                                                                                                                            | Workforce session                 | None                                                                                                       | Access audited                                                                   | Existing — **never surfaced in Arena 4 read surfaces** (see §3)       |
| Compliance cases / risk profile              | `compliance.manage_case`, `compliance.manage_risk_profile`                                                    | `SUPER_ADMIN`, `COMPLIANCE`                                                                       | No                                                                                                                            | Workforce session                 | None                                                                                                       | Audited                                                                          | Existing — **excluded from Arena 4 audit inspection by policy**       |
| Customer preferences                         | `customer.manage_support_case` (support relationship only)                                                    | `SUPER_ADMIN`, `OPERATIONS`, `CUSTOMER_SERVICE`                                                   | No                                                                                                                            | Workforce session                 | None                                                                                                       | Audited                                                                          | Existing — preference rows **excluded** from Arena 4 audit inspection |

### 1.2 Agent administration

| Action / resource                                            | Governing functions                                                                                  | Permitted roles                                                                          | Maker/checker                                                               | MFA                         | Institution scope                                                           | Audit requirement                         | Status                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| View agent / aggregator                                      | `agent.view`, `aggregator.view`                                                                      | `SUPER_ADMIN`, `ADMINISTRATOR`, `OPERATIONS`, `AGENT_NETWORK_MANAGER`, `FINANCE_AUDITOR` | No                                                                          | Workforce session           | Institution affiliation visible, not filterable in Arena 4                  | Read audited on deny                      | Existing                                 |
| Review application, activate, suspend, terminate, reactivate | `agent.review_application`, `agent.activate`, `agent.suspend`, `agent.terminate`, `agent.reactivate` | `SUPER_ADMIN`, `AGENT_NETWORK_MANAGER`                                                   | No                                                                          | Workforce session           | `INSTITUTION_AGENT_AFFILIATION_CHANGE` is protected-authority maker/checker | `AUDIT` per transition                    | Existing                                 |
| Credentials, outlets, terminals                              | `agent.manage_credentials`, `agent.manage_outlets_terminals`                                         | `SUPER_ADMIN`, `AGENT_NETWORK_MANAGER`                                                   | No                                                                          | Workforce session           | None                                                                        | `AUDIT` (no credential material recorded) | Existing                                 |
| Limits and classes                                           | `agent.assign_limit`, `agent.manage_classes`                                                         | `SUPER_ADMIN`, `AGENT_NETWORK_MANAGER`                                                   | `agent.assign_limit` explicitly **not** maker/checker governed (Decision 2) | Workforce session           | None                                                                        | `AUDIT`                                   | Existing                                 |
| Agent funding / defunding                                    | `agent.fund` (initiate), `agent.defund` (initiate) + `agent.fund`/`agent.defund` approve             | `AGENT_NETWORK_MANAGER` initiates, `FINANCE_CONTROLLER` approves                         | **Yes** — cross-functional, `minimumApprovals: 1`, `selfApprovalProhibited` | **MFA required both sides** | None                                                                        | Approval + consumption audited            | Existing (not activated by this mission) |

### 1.3 Commercial configuration

| Action / resource                                | Governing functions                                                                          | Permitted roles                                                                                             | Maker/checker                                                         | MFA               | Institution scope | Audit requirement                                                  | Status                                            |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------- | ----------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| View fee / commission / reward / product / limit | `fee_rule.view`, `commission_rule.view`, `reward_rule.view`, `product.view`, `limit.view`    | `SUPER_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`, `AGENT_NETWORK_MANAGER` (limit) | No                                                                    | Workforce session | None              | Read audited on deny                                               | Existing                                          |
| Create / modify fee, commission, reward rules    | `fee_rule.create`/`modify`, `commission_rule.create`/`modify`, `reward_rule.create`/`modify` | `FINANCE_PREPARER` (INITIATE), `FINANCE_CONTROLLER` (APPROVE)                                               | **Yes** — Decision 2, `minimumApprovals: 1`, self-approval prohibited | **MFA**           | None              | Request, decision, consumption audited                             | Existing                                          |
| Product / limit governance                       | `product.modify`, `product.governance`, `limit.modify`                                       | `FINANCE_PREPARER` initiate, `FINANCE_CONTROLLER` approve                                                   | **Yes**                                                               | **MFA**           | None              | Audited                                                            | Existing                                          |
| Finance control policy activation                | `finance.control_policy.activate`                                                            | `FINANCE_PREPARER` initiate, `FINANCE_CONTROLLER` approve                                                   | **Yes**                                                               | **MFA**           | None              | Audited                                                            | Existing                                          |
| Provider governance (banking / notification)     | `banking.provider.propose`/`approve`, `notification.provider.configure`                      | `SUPER_ADMIN` + `FINANCE_PREPARER` propose, `FINANCE_CONTROLLER`/`SUPER_ADMIN` approve                      | **Yes**                                                               | **MFA**           | None              | Audited; provider secret metadata excluded from Arena 4 inspection | Existing — **production providers not activated** |

### 1.4 Workforce administration

| Action / resource                                                                                      | Governing functions                                                      | Permitted roles                                                         | Maker/checker                                                                        | MFA                              | Institution scope                                               | Audit requirement                                      | Status                        |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------- |
| Workforce user listing / profile                                                                       | `workforce.user.view`                                                    | `SUPER_ADMIN`, `ADMINISTRATOR`, `OPERATIONS`                            | No                                                                                   | Workforce session                | None                                                            | Audited on deny                                        | Existing                      |
| Create / suspend workforce user                                                                        | `workforce.user.create`, `workforce.user.suspend`                        | `SUPER_ADMIN`, `ADMINISTRATOR`, `OPERATIONS`                            | No                                                                                   | Workforce session                | None                                                            | Audited                                                | Existing                      |
| Role definition create / modify                                                                        | `workforce.role.create`, `workforce.role.modify`                         | `SUPER_ADMIN` initiates, `FINANCE_CONTROLLER` approves                  | **Yes** (`RoleDefinitionGovernanceService` proposer ≠ approver)                      | **MFA**                          | None                                                            | Audited                                                | Existing                      |
| Assign / revoke privileged role                                                                        | `workforce.role.assign`, `workforce.role.revoke`                         | `SUPER_ADMIN` INITIATE, `FINANCE_CONTROLLER` APPROVE                    | **Yes** — `FINANCE_ROLE_ASSIGN`/`_REVOKE`, separation of duties enforced server-side | **MFA**                          | Institution assignments governed separately                     | Approval + consumption audited                         | Existing                      |
| Assign / revoke operational role                                                                       | `workforce.role.assign_operational`, `workforce.role.revoke_operational` | `SUPER_ADMIN`, `ADMINISTRATOR`                                          | No (operational role set only; privileged roles excluded by the service)             | Workforce session                | None                                                            | Audited                                                | Existing                      |
| Super-admin recovery                                                                                   | `workforce.super_admin.recover`                                          | `ADMINISTRATOR`                                                         | **Yes** — recovery statement + approval                                              | **MFA**                          | None                                                            | Audited                                                | Existing                      |
| **Direction: users, roles, effective permissions, institution restrictions, account status, sessions** | `workforce.role.view`                                                    | `SUPER_ADMIN`, `ADMINISTRATOR`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR` | No — **read-only projection; no grant/revoke/elevate route**                         | Workforce session (route policy) | Institution assignment shown; `INSTITUTIONS` vs `NONE` explicit | Denied access audited (`auditDeniedWorkforceFunction`) | **Added (read-only)**         |
| Unrestricted role grant / self-elevation                                                               | _none_                                                                   | _none_                                                                  | Would require new policy                                                             | —                                | —                                                               | —                                                      | **Blocked** — not implemented |

### 1.5 Notification operations

| Action / resource                                                               | Governing functions                     | Permitted roles                                                      | Maker/checker                       | MFA               | Institution scope                      | Audit requirement                        | Status                                                   |
| ------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------- | ----------------------------------- | ----------------- | -------------------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| Delivery listing, per-delivery detail, attempt/retry history                    | `notification.view_deliveries`          | `SUPER_ADMIN`, `OPERATIONS`, `FINANCE_AUDITOR`                       | No                                  | Workforce session | None (deliveries carry no institution) | Denied access audited                    | **Added (read-only)**                                    |
| Operations summary: status counts, retry backlog, sanitized failure diagnostics | `notification.view_deliveries`          | as above                                                             | No                                  | Workforce session | None                                   | Denied access audited                    | **Added (read-only)**                                    |
| Provider identity in the summary                                                | `notification.provider.view` (additive) | `SUPER_ADMIN`, `OPERATIONS`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR` | No                                  | Workforce session | None                                   | Denied access audited                    | **Added (read-only, two-tier projection)**               |
| Provider configuration / secret metadata                                        | `notification.provider.configure`       | `SUPER_ADMIN` propose, `FINANCE_CONTROLLER` approve                  | **Yes**                             | **MFA**           | None                                   | Audited; secrets never in audit payloads | Existing — **not exposed on Arena 4 routes**             |
| Test send                                                                       | `notification.test_send`                | `SUPER_ADMIN`, `OPERATIONS`                                          | No                                  | Workforce session | None                                   | Audited                                  | Existing (out of Arena 4 scope)                          |
| **Manual delivery retry**                                                       | _no approved function_                  | _none_                                                               | Would require a new governed action | —                 | —                                      | —                                        | **Blocked** — `retryPolicy.manualRetrySupported = false` |

### 1.6 Operational audit inspection

| Action / resource                                                                            | Governing functions                         | Permitted roles                                                    | Maker/checker | MFA               | Institution scope                                                               | Audit requirement     | Status                                          |
| -------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ | ------------- | ----------------- | ------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------- |
| Audit search/filter + detail (actor, action, resource, timestamp, outcome, approval history) | `audit.view` **and** `audit.search`         | `SUPER_ADMIN`, `FINANCE_AUDITOR`                                   | No            | Workforce session | Derived from `new_values`/`previous_values`; unrecorded ⇒ `institutionId: null` | Denied access audited | **Added (read-only)**                           |
| Legacy audit listing                                                                         | `audit.search` (SUPPORT explicit exception) | `SUPER_ADMIN`, `FINANCE_AUDITOR`, `SUPPORT` (documented exception) | No            | Workforce session | n/a                                                                             | Denied access audited | Existing — unchanged, deliberately not extended |
| Customer preference / compliance case records                                                | —                                           | —                                                                  | —             | —                 | —                                                                               | —                     | **Excluded by construction**                    |
| Provider-secret audit metadata                                                               | —                                           | —                                                                  | —             | —                 | —                                                                               | —                     | **Excluded by construction**                    |

---

## 2. Implemented surfaces

### 2.1 Routes (all `GET`, all workforce-session authenticated, all read-only)

| Route                                                   | Route-policy family                | Required catalogue functions                                                          |
| ------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/v1/internal/notifications/operations/summary` | `internal-notification-operations` | `notification.view_deliveries` (`SUPPORT` exempt, per the existing family convention) |
| `GET /api/v1/internal/notifications/deliveries`         | `internal-notification-operations` | `notification.view_deliveries`                                                        |
| `GET /api/v1/internal/notifications/deliveries/:id`     | `internal-notification-operations` | `notification.view_deliveries`                                                        |
| `GET /api/v1/internal/workforce/directory`              | `internal-workforce-directory`     | `workforce.role.view`                                                                 |
| `GET /api/v1/internal/workforce/directory/:principalId` | `internal-workforce-directory`     | `workforce.role.view`                                                                 |
| `GET /api/v1/internal/audit/inspection`                 | `internal-audit-inspection`        | `audit.view` **and** `audit.search`                                                   |
| `GET /api/v1/internal/audit/inspection/:id`             | `internal-audit-inspection`        | `audit.view` **and** `audit.search`                                                   |

No write verb exists on any Arena 4 route, and no catalogue function, role or migration was added.

### 2.2 Backend modules

| File                                                         | Purpose                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/admin/notification-operations.service.ts`               | Read-only delivery summary/detail projection; canonical states `PENDING\|SENT\|FAILED\|SKIPPED\|UNKNOWN\|DEAD`; attempt history from `notification_delivery_attempts`; sanitized failure codes; two-tier provider projection. |
| `src/admin/notification-operations.controller.ts`            | Summary + delivery detail; strict query validation.                                                                                                                                                                           |
| `src/admin/admin-notification.controller.ts`                 | Delivery listing gains bounded `search`, `from`, `to` filters over the existing projection.                                                                                                                                   |
| `src/workforce-visibility/workforce-directory.service.ts`    | Read-only directory/detail; account-status derivation, effective + administrative permissions, institution scope, session counts, `readOnlyPrincipal`.                                                                        |
| `src/workforce-visibility/workforce-directory.controller.ts` | Directory and principal detail; advertises `boundaries.readOnly` and the existing grant/revoke routes it does not own.                                                                                                        |
| `src/operations/audit.service.ts`                            | `restrictedQuery()`, `inspect()`, `inspectOne()`, filter application and row projection. All inspection reads flow through this one restricted path.                                                                          |
| `src/operations/audit-inspection.controller.ts`              | Search + detail; 404 for missing **and** policy-excluded records (no existence oracle).                                                                                                                                       |
| `src/authorization/route-policy-registry.ts`                 | Three new route families with the functions listed above.                                                                                                                                                                     |

### 2.3 Admin Web

| File                                                                        | Purpose                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/admin-web/src/services/arena4-operations-api.ts`                      | Typed read-only adapters + `describeHttpError` (status-aware, no axios shape assumptions).                                      |
| `apps/admin-web/src/screens/authenticated/NotificationOperationsScreen.tsx` | Summary, filters, delivery table with per-attempt retry history; states that manual retry is unsupported.                       |
| `apps/admin-web/src/screens/authenticated/WorkforceDirectoryScreen.tsx`     | Directory, filters, principal detail with effective permissions, institution restrictions, sessions; read-only boundary notice. |
| `apps/admin-web/src/screens/authenticated/AuditInspectionScreen.tsx`        | Search over actor/action/resource/outcome/institution/time, detail with approval history and related events, privacy notice.    |
| `apps/admin-web/src/screens/authenticated/arena4-operations.css`            | `.a4-ops*` presentation contract for the three screens.                                                                         |
| `apps/admin-web/src/screens/authenticated/navigation-access.ts`             | `notificationOperations`, `workforceDirectory`, `auditInspection` views gated by exactly the functions the backend enforces.    |
| `apps/admin-web/src/screens/authenticated/Layout.tsx`                       | Navigation entries and screen registration.                                                                                     |

### 2.4 Privacy decisions (why the projection is narrow by construction)

- **One restricted read path.** Audit inspection can only be executed through
  `AuditService.restrictedQuery()`. There is no second query builder, and the controller cannot pass
  an exclusion opt-out.
- **Excluded categories, server-side.** `AUDIT_INSPECTION_EXCLUDED_CATEGORIES` removes customer
  preference and compliance-case records from the result set, not from the client render.
- **Provider secrets.** Provider-secret metadata requires an internal-only, never request-derived
  opt-in; the default deny is what the Admin Web receives.
- **No existence oracle.** `inspectOne()` returns `null` for absent and excluded ids alike, and the
  controller turns both into `404`.
- **No credential material.** Workforce projection never selects `a2_workforce_sessions.token_hash`
  (asserted in `workforce-directory.service.spec.ts`).
- **Redaction.** Credential-shaped actor/correlation values are masked by
  `sanitizeDiagnosticIdentifier`, and the integration suite asserts an email-shaped actor is
  redacted.
- **Product defect found and fixed.** The exclusion predicate compared
  `audit.new_values ->> 'resourceType'` to a literal; for rows where the key is absent the
  comparison yields `NULL`, so `NOT (NULL OR …)` evaluated to `NULL` and excluded **every** row —
  detail inspection always returned 404. The predicate now uses
  `COALESCE(audit.new_values ->> 'resourceType','')`.

---

## 3. Verification performed

| Layer                                                        | Command                                                                                        | Result                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------- |
| Backend unit — notification operations                       | `jest src/admin/notification-operations.service.spec.ts`                                       | 4/4 pass                           |
| Backend unit — workforce directory                           | `jest src/workforce-visibility/workforce-directory.service.spec.ts`                            | 5/5 pass                           |
| Backend route-policy / admin matrix                          | `jest` (admin + route-policy suites)                                                           | 195 pass                           |
| Backend real PostgreSQL — Arena 4 governance                 | `jest -c jest.integration.config.js test/arena4-governance-operations.integration.spec.ts`     | 14/14 pass                         |
| Backend real PostgreSQL — maker/checker concurrency & replay | `jest -c jest.integration.config.js test/arena4-maker-checker-concurrency.integration.spec.ts` | 11/11 pass, three consecutive runs |
| Backend real PostgreSQL — curated regression (see §4)        | 15 suites, one Jest process per suite                                                          | all pass                           |
| Backend TypeScript build                                     | `npx tsc -p tsconfig.build.json --noEmit`                                                      | pass (2026-11-22)                  |
| Admin Web TypeScript                                         | `npx tsc --noEmit` (in `apps/admin-web`)                                                       | pass                               |
| Admin Web tests                                              | `npx jest` (in `apps/admin-web`)                                                               | 91 suites / 907 tests pass         |

Maker/checker concurrency and replay assertions (real PostgreSQL, real transactions):

- Two checkers approving the same request simultaneously: exactly one decision commits, the other
  observes the committed state; exactly one `PRIVILEGED_ACTION_APPROVED` audit record; `version`
  advances once.
- Concurrent approve/reject: exactly one terminal outcome, one decision audit record, and the loser
  never reports success.
- Stale `expectedVersion` is refused without mutating the row; the current version then succeeds.
- Self-approval by the maker is refused (`SELF_APPROVAL_FORBIDDEN`).
- A checker lacking the approving function is refused (`FUNCTION_MISSING`), a checker without MFA is
  refused (`MFA_REQUIRED`), and neither denied attempt records a decision.
- Consumption: concurrent double-consume yields exactly one `CONSUMED` and one `PRIVILEGED_ACTION_CONSUMED`
  audit record; sequential replay is refused with `CONSUMED`; a different resource
  (`RESOURCE_MISMATCH`) or fingerprint (`FINGERPRINT_MISMATCH`) is refused without consuming; an
  unrelated principal cannot consume (`APPROVAL_SCOPE_MISSING`).

Admin Web coverage added: 4 suites / 17 tests — screen render + gating, server-side filter
propagation, detail projection without write helpers, privacy notices, 404 handling, and
navigation gating parity with the backend route policy.

---

## 4. Real-PostgreSQL regression status

Environment: real PostgreSQL 16 on `127.0.0.1:5432`, `NODE_ENV=test`, workers disabled, one Jest
process per suite (`--runInBand`), disposable-cluster confirmation set. The repository's own runner
(`npm run test:pg`) spawns one process per suite for exactly this reason: a single long-lived Jest
process over the whole estate exhausts the 3.9 GB sandbox heap (observed `SIGABRT`, exit 134) part
way through. The full 190-file matrix therefore remains the CI gate (`backend-postgres` job, which
runs `npm run test:pg` on every PR), and the suite selection below is what was executed locally.

All of the following passed against the final working tree, one process each:

| Suite                                                                              | Why it is in the regression set              | Result   |
| ---------------------------------------------------------------------------------- | -------------------------------------------- | -------- |
| `test/arena4-governance-operations.integration.spec.ts`                            | New surfaces end to end                      | 14/14    |
| `test/arena4-maker-checker-concurrency.integration.spec.ts`                        | New concurrency/replay evidence              | 11/11 ×3 |
| `test/a22-admin-foundation.integration.spec.ts`                                    | Admin foundation + workforce session surface | pass     |
| `test/v1-admin-authorization-foundation-01.integration.spec.ts`                    | Catalogue/route-policy foundation            | pass     |
| `test/v1-admin-authorization-hardening-01.integration.spec.ts`                     | Route-policy hardening                       | pass     |
| `test/v1-admin-authorization-read-surface-01.integration.spec.ts`                  | Read-surface gating                          | pass     |
| `test/v1-admin-full-surface-audit-01-auth-propagation.integration.spec.ts`         | Audit actor/authorization propagation        | pass     |
| `test/v1-harden-01-runtime-access-guard-boundary.integration.spec.ts`              | Runtime access guard boundary                | pass     |
| `test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts` | Existing delivery diagnostics projection     | pass     |
| `test/v1-sprint1-notification-delivery-authorization.integration.spec.ts`          | Delivery listing denial contract (see below) | 19/19    |
| `test/emergency-access-review.integration.spec.ts`                                 | Break-glass approvals                        | pass     |
| `test/compliance-audit-export.integration.spec.ts`                                 | Audit read/export                            | pass     |
| `test/v1-admin-role-definition-governance-implementation-01.integration.spec.ts`   | Role-definition maker/checker                | pass     |
| `test/v1-security-super-admin-recovery-01.integration.spec.ts`                     | Super-admin recovery approvals               | pass     |
| `test/a2-workforce-session.integration.spec.ts`                                    | Workforce sessions / assurance               | pass     |

### Regression caught and fixed in this mission

The first version of the new `internal-notification-operations` route policy also matched the
**pre-existing** `GET /api/v1/internal/notifications/deliveries` listing. That shadowed the baseline
branch, which authorizes the listing inside `AdminNotificationController` against the
`internal-notifications` resource type, and changed the `resourceType` recorded on `DENIED`
authorization decisions — an observable audit contract asserted by
`v1-sprint1-notification-delivery-authorization.integration.spec.ts`. The family now covers only the
routes Arena 4 adds (`operations/summary` and the new per-delivery detail), listed as
`internal-notification-operations`; the baseline listing path is untouched and that suite is green
again (19/19).

### Flake found in the new concurrency suite and fixed

The approve/reject race test initially assumed the approval always wins. The service is correct in
both orderings — the loser always reports the committed status — so the test now asserts
order-independent invariants (exactly one decision audit record, `approved === (status ===
'APPROVED')`, both callers report the committed status) plus a deterministic
rejection-commits-first case. It passes 11/11 on three consecutive runs.

---

## 5. Remaining blockers and integration dependencies

### Blockers

1. **Manual notification retry is not approved policy.** `docs/V1/V1-ADMIN-WEB-PAGE-INVENTORY-01.md`
   (line 252) specifies the deliveries surface as read-only. The summary therefore returns
   `retryPolicy.manualRetrySupported = false` and the Admin Web shows no retry control. Implementing
   retry requires an approved governed action (request/approve/consume) plus a worker-side execution
   contract — neither exists.
2. **Institution scope of deliveries is not modelled.** Deliveries carry no institution column, so
   Notification Operations cannot be institution-filtered without a schema and attribution decision.
3. **Approval-history linkage is heuristic.** `approvalHistory` matches approvals by id, resource and
   approval reference; there is no foreign key from `audit_events` to
   `privileged_action_approvals`, so a related approval can be missed if the correlation is not
   recorded. Fixing this is a schema decision outside Arena 4's authority.
4. **Authenticated browser acceptance** requires a running stack plus seeded workforce identities.
   The Admin Web suites cover the screens against the typed API contracts, but the scripted
   authenticated browser run (`npm run acceptance:browser:admin`) is an integration-environment task
   for Arena 5's harness.
5. **`workforce.role.view` is held by `FINANCE_AUDITOR`**, a read-only role. The directory is
   projection-only, so this is consistent with the catalogue, but any future write control on this
   surface must not reuse that function.

### Integration dependencies (owners, not edited by this mission)

| Dependency                                               | Owner     | What Arena 4 needs                                                                                                                                          |
| -------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared navigation, screen shell, auth-context remount    | Arena 5   | The three views are registered in `navigation-access.ts` / `Layout.tsx`; Arena 5 owns the shell and can relocate the entries without touching the screens.  |
| Customer/institution attribution and KYC evidence policy | Arena 1   | Confirmation that customer preference and compliance-case audit records stay excluded; any future inclusion requires an approved policy, not a client flag. |
| Agent administration and credential surfaces             | Arena 2   | No change requested. Workforce directory shows agent principals read-only; agent write actions remain on Arena 2 routes.                                    |
| Commercial configuration governance                      | Arena 3   | No change requested. Commercial maker/checker rows in §1.3 are reported, not implemented here.                                                              |
| Notification delivery infrastructure                     | Arena 1/3 | Arena 4 consumes `notification_deliveries`, `notification_delivery_attempts` and provider configuration as-is. No retry, no new provider, no new worker.    |

### Explicitly not done

- No financial execution, ledger posting, or institution activation was enabled.
- No production provider was configured or activated.
- No catalogue function, role, or migration was added.
- No merge or deployment.
