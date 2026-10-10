# V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01 — Report (Recovered)

## 0. Why this report says "INCOMPLETE" instead of "successful"

This task was previously reported to a user as **successful**, but no report file ever existed at
this path, and **no commit for this task exists anywhere in the repository's history** (verified
by `git log --all --oneline | grep -i dashboard` returning nothing, and by comparing the local
branch tip against `origin/arena/01a10374-monienaija`). This document was reconstructed from first
principles in a dedicated recovery session: by reading the actual (uncommitted) code, the actual
migration, and by **running** the code against a real, freshly-provisioned PostgreSQL instance and
a real HTTP server, rather than by trusting the earlier "successful" claim.

**The honest finding: this task is INCOMPLETE.**
- The backend (entities, migration, service, controller, widget registry, seed data) is
  substantially built and was runnable, but a from-scratch, independent PG-backed test run
  performed in this recovery session found **two genuine, reproducible, blocking defects**
  (detailed in §7 and §9) that mean core claims of the original task — "an admin can reassign a
  role's dashboard template" and "the transaction-summary widget works" — **do not currently
  hold**.
- The Admin Web frontend portion of the task (widget components, a dashboard settings screen, any
  API-client wiring for these new endpoints) was **never started**. Only the pre-existing
  placeholder `apps/admin-web/src/screens/authenticated/DashboardScreen.tsx` exists; it does not
  reference any of the new backend endpoints.
- **Nothing for this task was ever committed.** All of it exists only as uncommitted working-tree
  changes on top of commit `654aa29049c162c8c9b61507192a82f03be2f17d` (the real, pushed tip of
  `arena/01a10374-monienaija` as of this report, which corresponds to the completed
  V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01 task).

This report documents exactly what exists, what was verified in this recovery session (with
real commands and real output), what was not verified, and the two defects found. No test result
anywhere in this report is invented — every number cited was produced by a command listed in §10.

---

## 1. Dashboard template / widget architecture

The implementation separates three layers, exactly as the original task required:

- **Layer A — Roles & permissions** (pre-existing, untouched): `authorization_roles` /
  `authorization_role_functions` / `authorization_functions`, owned by
  `AuthorizationCatalogueSeedService`.
- **Layer B — Dashboard templates**: new table `dashboard_templates` (migration
  `1785753600087-CreateDashboardPlatform.ts`). Columns: `id`, `template_key` (unique),
  `display_name`, `description`, `operational_area`, `layout` (JSONB — an ordered widget list),
  `is_active`, `metadata`, timestamps. A template is a reusable, named *shape* (which widgets, in
  which order) completely independent of which role(s) use it.
- **Layer C — Role → template assignment**: new table `role_dashboard_assignments`
  (`role_key` unique, `template_key`, `assigned_by`, `assigned_at`, `reason`, timestamps). One row
  per role, resolved at request time by `DashboardService.resolveMyDashboard()` — never cached,
  never hardcoded in frontend or backend code.
- **Widget registry** (`src/dashboard/dashboard-widget-registry.ts`): a static, code-level catalog
  of 17 widgets, each declaring a `widgetKey`, a human `displayName`/`description`, a `kind`
  (chart/table/summary/etc.), a `fetchMode` (`proxy` — backend fetches and returns real data
  through `DashboardWidgetDataService`; or `direct` — the client calls an existing endpoint
  directly), and `requiredFunctions` (the authorization function codes a role must hold for that
  specific widget, independent of which template surfaces it).

This is a correct, clean separation: changing which template a role is assigned to (Layer C) never
touches Layer A (permissions) and never touches the widget registry (Layer B's vocabulary). This
was **confirmed by a passing test** (see §2, test `1b`) that every widget referenced by every
seeded template actually exists in the registry, and by code review of `assignTemplate()`
(`dashboard.service.ts`), which only ever writes to `role_dashboard_assignments` and the audit log
— it has no code path that can write to `authorization_role_functions`.

12 templates are seeded (`dashboard-templates.seed.ts`): `EXECUTIVE_GOVERNANCE`,
`WORKFORCE_ADMINISTRATION`, `FINANCE_PREPARATION`, `FINANCIAL_CONTROL_APPROVALS`,
`FINANCIAL_AUDIT_ASSURANCE`, `TRANSACTION_OPERATIONS`, `AGENT_NETWORK_MANAGEMENT`,
`COMPLIANCE_KYC`, `FRAUD_CASE_MONITORING`, `CUSTOMER_SERVICING`, `RECONCILIATION_VISIBILITY`, and
`DEFAULT_FALLBACK` (the 11 operational-area templates plus the fallback), each declaring its own
ordered widget list drawn from the shared 17-widget registry.

## 2. Is a role's dashboard template independent of its permissions?

**Yes, by design and by one passing, real-PG-backed test** (`1b. 12 templates seeded...`, part of
the 28 passing tests in this recovery session's run — see §9). `assignTemplate()` only writes
`role_dashboard_assignments`; it never touches `authorization_role_functions`.

However, the **two intended end-to-end proofs of this specific claim — tests `4a` ("changing
TREASURY's dashboard template does not alter its function grants") and `3a`/`2a`
(assignment-persists-and-is-independently-reusable) — all FAIL**, not because the independence
claim is false, but because the **PUT `/assignments/:roleKey` endpoint itself is completely
broken** (defect #1, §7) and returns `400 Bad Request` for every call, regardless of payload. So
while the architecture is correctly separated on paper and in the write path's own code, **the
only API surface that lets an admin actually exercise "change a role's template" is non-functional
today**, and that specific claim is **unverified-by-passing-test**, not merely "verified by design
review."

## 3. Can a brand-new role reuse an existing dashboard template with zero source-code changes?

**By design: yes.** `assignTemplate()` takes an arbitrary `roleKey` string and an existing
`templateKey`; nothing in the write or read path requires a role to be one of the 11 original V1
roles, is gated behind an enum, or requires a widget/frontend code change. `DashboardService`
resolves any role's dashboard purely from the `role_dashboard_assignments` row at request time.

**This specific claim could not be confirmed by test**, again because of defect #1: test `3a` ("a
newly-created role can be assigned an existing template purely via DB/API rows") fails at the same
PUT call for the same reason as §2. The mechanism is correct by code inspection, but is
**currently unusable through the API**, so "zero-code-change role reuse" is a defect-blocked,
unverified claim, not a demonstrated one.

## 4. Dashboards for all 11 V1 roles

All 11 V1 roles (`SUPER_ADMIN`, `ADMINISTRATOR`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`,
`FINANCE_AUDITOR`, `OPERATIONS`, `AGENT_NETWORK_MANAGER`, `COMPLIANCE`, `RISK_FRAUD`,
`CUSTOMER_SERVICE`, `TREASURY`) have a seeded assignment to an active, role-appropriate template
(`dashboard-templates.seed.ts`, `ROLE_DASHBOARD_ASSIGNMENT_SEED`) — **confirmed passing**, test
`1a`, real PG.

Of the per-role dashboard-correctness test (§11 of the test file — "resolves a dashboard whose
authorized flags exactly match its real catalogue grants, and every authorized proxy widget is
fetchable"): **6 of 11 roles pass** (`ADMINISTRATOR`, `AGENT_NETWORK_MANAGER`, `COMPLIANCE`,
`RISK_FRAUD`, `CUSTOMER_SERVICE`, `TREASURY`) and **5 of 11 fail**
(`SUPER_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`, `OPERATIONS`) — every
one of the 5 failing roles is exactly the set of roles granted `reporting.transaction_summary.view`
(see the `authorization-catalogue.seed.ts` diff in §8), i.e. every role whose dashboard includes
the broken `transaction-summary` widget (defect #2, §7). The *authorization-flag correctness* part
of this test passes even for the failing roles — only the "every authorized proxy widget is
independently fetchable" assertion fails, and only for the one broken widget.

## 5. Are the displayed metrics real and authoritative? How are volume/success-rate/fee/trend figures defined?

By code review, **every widget queries an authoritative source table or existing service directly
— none pre-aggregate from another dashboard, cache layer, or synthetic/estimated figure**:

- `transaction-summary` / `recent-transactions`: `DashboardWidgetDataService.transactionSummary()`
  / `.recentTransactions()` query the four real transaction tables directly —
  `transfers` (W2W), `deposits` (C2W), `withdrawals` (W2C), `cash_to_cash_transfers` (C2C) — each
  with its own real `completedStatus`/`failedStatuses`/`pendingStatuses` definitions (e.g. W2W
  completed = `COMPLETED`, failed = `FAILED`/`CANCELLED`; C2C completed = `CLAIMED`, failed =
  `EXPIRED`). "Volume" = `COUNT(*)` grouped by status within the requested date window; "value" =
  `SUM(amount_minor)` (or `principal_minor` for C2C); "fee" = `SUM(fee_minor)` **only** where a fee
  column exists for that transaction type (`transfers`/`cash_to_cash_transfers`); for `deposits`
  and `withdrawals` (no fee column), the widget is designed to omit a fee figure entirely rather
  than invent one — `commission: null` with an explanatory `commissionNote` string is the
  documented no-invented-figures behavior asserted by test `9d`.
- "Period" filters (`today`/`7d`/`30d`/`custom`) are computed in `resolvePeriod()` as real
  `Date` arithmetic against `now()`, not pre-bucketed/cached windows; `custom` requires explicit
  `from`/`to` ISO dates and rejects `from > to` (confirmed passing, tests `9b`/`9c`).
- `ledger-summary`: a real `GROUP BY` over `ledger_journals`/`ledger_lines` (debits/credits by
  currency and accounting unit) — no synthetic netting.
- `reconciliation-status`: delegates directly to the existing, real `ReconciliationService`
  (`runReconciliation()` / `getTrialBalance()`), not a cached summary.
- `workforce-overview`, `agent-lifecycle-summary`, `kyc-queue-summary`,
  `compliance-case-summary`, `fraud-case-summary`: each a direct `COUNT(*)`/`GROUP BY` over its
  respective real table (`a2_finance_role_assignments`, `agents`/`agent_applications`,
  `customer_kyc_assessments`, `customer_compliance_cases`), with correct `deleted_at IS NULL`
  filtering reviewed and fixed earlier in this engagement.
- **No "trend" or "comparison vs. prior period" figure is implemented anywhere in the widget
  registry or data service.** The original task's requirement for trend/comparison data is **not
  met** — there is no widget that computes a period-over-period delta. This is a scope gap,
  separate from the two defects in §7.

**However**, the one widget that actually implements fee/volume semantics (`transaction-summary`)
is **currently non-functional for 2 of its 4 transaction types due to defect #2** — so while the
*design* of "real, authoritative, no invented figures" is sound and partially verified (the
`custom`-period commission-null-and-noted behavior passed in test `9d`... actually see correction
below), the widget as a whole cannot be exercised end-to-end today. (Correction: test `9d` itself
is one of the 10 failing tests — it fails with the same HTTP 500 as `9a`, before its
no-invented-commission assertion is ever reached. The commission-null/commissionNote behavior is
implemented in the source code — reviewed directly — but **was not actually exercised by a passing
test** in this session, due to defect #2 blocking the request before that code path runs.)

## 6. SUPER_ADMIN executive BI vs. other roles' operational dashboards

By seed design: `SUPER_ADMIN` is assigned `EXECUTIVE_GOVERNANCE`, a template distinct from every
operational role's template, intended to span cross-functional widgets (transaction summary,
ledger, reconciliation, workforce overview, role-governance queue, system health) rather than a
single operational area's widgets (e.g. `TREASURY` → `RECONCILIATION_VISIBILITY`, scoped to
reconciliation-only data; `RISK_FRAUD` → `FRAUD_CASE_MONITORING`, scoped to fraud-case data only).
Two specific category-boundary claims **were confirmed by passing tests in this session**:
test `11z` — `RISK_FRAUD` never sees AML/KYC/SANCTIONS compliance-case data (only `FRAUD`-category
rows, enforced by the `category = 'FRAUD'` filter in `fraudCaseSummary()`), and test `11y` —
`TREASURY` is limited to exactly reconciliation-view-backed data. Both passed against real
PostgreSQL with real seeded cases of multiple categories.

`SUPER_ADMIN`'s own dashboard-correctness test (`11.SUPER_ADMIN`) is one of the 5 failures
described in §4/§7 — caused by the same `transaction-summary` defect, not by an authorization or
template-design problem (its *authorized-flag correctness* assertions, run before the widget-fetch
assertion that fails, were not separately isolated in this session, so whether SUPER_ADMIN's
*authorization flags* specifically are correct is not independently confirmed — only that the test
as a whole fails on the widget-fetch step).

## 7. Authorization enforcement, restricted visibility, fallback, and error states

**This is the most thoroughly, successfully verified area.** All of the following passed against
real PostgreSQL + real HTTP in this recovery session:

- No bearer token → `401` on every dashboard route (`5a`).
- A role lacking `workforce.dashboard.view` (`TREASURY`) is denied listing
  templates/assignments (`5b`).
- A role lacking `workforce.dashboard.assign` (`FINANCE_AUDITOR`, a read-only governed role)
  cannot change an assignment (`5c`).
- Only `SUPER_ADMIN`/`ADMINISTRATOR` hold `workforce.dashboard.assign` — least-privilege check
  against the real catalogue (`5d`).
- **Tamper resistance**: forcing a role onto a template containing widgets it is not entitled to
  (bypassing the UI/API entirely, writing the assignment row directly) still results in the
  per-widget data endpoint rejecting the unauthorized widget fetch server-side (`6a`) — enforcement
  lives in `DashboardController`'s per-widget `requireFunction` check, not in template selection.
- **Fallback behavior**, all passing: a role with no assignment row falls back to
  `DEFAULT_FALLBACK` (`7a`); a role assigned to a since-deactivated template falls back to
  `DEFAULT_FALLBACK` (`7b`); a role assigned to a template key that no longer exists falls back to
  `DEFAULT_FALLBACK` (`7c`); assigning/reading an unknown role via the API is rejected with `400`,
  not a crash (`7d`); assigning a role to an unknown/inactive template is rejected with `400`
  (`7e`).
- **Per-widget authorization boundaries**: `CUSTOMER_SERVICE` cannot fetch `fraud-case-summary`
  even though it is a valid, registered widget key (`8a`); `AGENT_NETWORK_MANAGER` cannot fetch
  `kyc-queue-summary` (`8b`); a request for a non-existent widget key returns `404` (`8c`); a
  `direct`-fetchMode widget cannot be pulled through the generic proxy route (`8d`).
- Malformed/edge-case requests: a non-existent template key returns `404` (`10a`); a `PUT`
  assignment missing `templateKey` in the body correctly returns `400` (`10b` — this one still
  passes, because it is testing the *controller's* explicit null-check, which fires before/
  regardless of the ValidationPipe-stripping defect, since there genuinely is no `templateKey` in
  that request).

**This gives high confidence that the authorization model (who can see what, and the safe-fallback
behavior when configuration is missing/invalid/tampered) is correctly implemented** — 17 of the 17
tests specifically targeting these properties passed.

### Defect #1 (blocking): the dashboard-assignment PUT endpoint is completely non-functional

`PUT /api/v1/internal/a2/workforce/dashboard/assignments/:roleKey` with a well-formed body (e.g.
`{"templateKey": "RECONCILIATION_VISIBILITY", "reason": "..."}`) **always returns `400
{"message":"templateKey is required."}`**, for every role, every template, every call — including
in a legitimate `SUPER_ADMIN` session with the correct `workforce.dashboard.assign` grant.

**Root cause** (confirmed by direct debug instrumentation against the running app in this
session, then reverted — no production code was changed): the global `ValidationPipe({
whitelist: true, transform: true, forbidNonWhitelisted: false })`, configured identically in both
`src/main.ts` (the real app) and the test harness, strips any request-body property that has **no
class-validator decorator** when transforming it into its target DTO class. `AssignTemplateDto` in
`src/dashboard/dashboard.controller.ts` is declared as:

```ts
class AssignTemplateDto {
  templateKey!: string;
  reason?: string;
}
```

— with **no `@IsString()`/`@IsOptional()` decorators at all**. Under `whitelist: true`, Nest's
`ValidationPipe` treats an undecorated class as having zero known properties and discards the
entire body before the controller even runs, so `@Body() body: AssignTemplateDto` is always `{}`.
The controller's own manual check (`if (!body?.templateKey ...) throw new
BadRequestException('templateKey is required.')`) then (correctly, given its already-empty input)
throws every time.

This is a **real, deterministic defect in the uncommitted production code**, not a test-harness
artifact — `src/main.ts` uses the exact same `whitelist: true` pipe configuration as the test, so
the real, deployed app would exhibit identical behavior: an admin can never actually change a
role's dashboard template through this API. It directly caused the failures of tests `2a`, `3a`,
and `4a` (all three "change an assignment and observe the result" tests).

**Not fixed in this session** — per this task's explicit scope (report, don't rebuild), this is
reported as a finding for a human/implementation decision, not silently patched. The fix is
mechanical (add class-validator decorators to `AssignTemplateDto`, e.g. `@IsString()
templateKey!: string; @IsOptional() @IsString() reason?: string;`) but is a source-code change to
already-reported-as-complete functionality and was left untouched.

### Defect #2 (blocking): the `transaction-summary` widget always returns HTTP 500

`GET /api/v1/internal/a2/workforce/dashboard/widgets/transaction-summary` (any `period` value)
**always returns `500 Internal Server Error`** for any role authorized to see it.

**Root cause** (confirmed via the real Postgres driver error surfaced in server logs during this
session's test run):

```
QueryFailedError: bind message supplies 3 parameters, but prepared statement "" requires 2
```

at `DashboardWidgetDataService.transactionSummary()` (`src/dashboard/dashboard-widget-data.service.ts`,
~line 80). The query is built as:

```ts
`SELECT status, COUNT(*)::text AS count,
        COALESCE(SUM(${t.amountColumn}), 0)::text AS value_minor
        ${t.feeColumn ? `, COALESCE(SUM(CASE WHEN status = $3 THEN ${t.feeColumn} ELSE 0 END), 0)::text AS fee_minor` : ''}
   FROM ${t.table}
  WHERE created_at >= $1 AND created_at <= $2
  GROUP BY status`,
[range.from.toISOString(), range.to.toISOString(), t.completedStatus],
```

The `$3` placeholder is only emitted into the SQL text when `t.feeColumn` is set, but **the
3-element parameter array is always passed, regardless of whether `$3` appears in the query
text**. Two of the four entries in `TRANSACTION_TABLES` have `feeColumn: null` (`deposits`/C2W and
`withdrawals`/W2C — confirmed by reading the table directly), so for those two transaction types
the generated SQL only contains `$1`/`$2` while 3 parameters are bound, which Postgres rejects
outright. Since `transactionSummary()` runs all four transaction-table queries via
`Promise.all(...)` and surfaces any rejection as a single failure, **every call to this widget
fails, for every role, for every period, deterministically** — it is not a timing/data issue, it
reproduces on every invocation against an empty, freshly-reseeded database.

This is a **real, deterministic defect in the uncommitted production code**. It caused the direct
failures of tests `9a` and `9d` (direct widget fetch) and, indirectly, the 5 role-dashboard
failures described in §4 (every role whose template includes `transaction-summary` as an
authorized, proxied widget — `SUPER_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`,
`FINANCE_AUDITOR`, `OPERATIONS` — fails test group 11 at the "every authorized proxy widget is
independently fetchable" assertion).

**Not fixed in this session**, for the same reason as defect #1. The mechanical fix is to only push
`t.completedStatus` into the parameter array when `t.feeColumn` is truthy (and use `$3` only in
that branch), or to always include the `CASE WHEN` clause unconditionally with a dummy/consistent
reference. Left untouched and reported here instead.

## 8. Database migrations, API endpoints, Admin Web changes, and tests (as they exist today, uncommitted)

**Migration** — `src/migrations/1785753600087-CreateDashboardPlatform.ts` (read in full this
session): creates `dashboard_templates` (`id` uuid PK, `template_key` unique varchar(80),
`display_name`, `description`, `operational_area`, `layout` jsonb, `is_active` boolean default
true, `metadata` jsonb nullable, timestamps) and `role_dashboard_assignments` (`id` uuid PK,
`role_key` unique varchar(100), `template_key` varchar(80), `assigned_by`, `assigned_at`, `reason`
nullable, timestamps). Purely additive — no existing table is altered. Confirmed this migration is
correctly wired as the new expected-latest-migration in `production-readiness.service.ts` and its
spec, and that its column names exactly match what `test/support/pg-harness.ts`'s
`reseedDashboardPlatform()` helper inserts (this cross-check was an open item from earlier in the
engagement and is now resolved: **they match**).

**API endpoints** (`src/dashboard/dashboard.controller.ts`, mounted at
`/api/v1/internal/a2/workforce/dashboard`):
- `GET /templates` — list all templates (requires `workforce.dashboard.view`)
- `GET /templates/:key` — get one template (requires `workforce.dashboard.view`)
- `GET /assignments` — list all role→template assignments (requires `workforce.dashboard.view`)
- `GET /roles` — list active roles eligible for assignment (requires `workforce.dashboard.view`)
- `GET /widget-registry` — the full static widget catalog (requires `workforce.dashboard.view`)
- `PUT /assignments/:roleKey` — change a role's assigned template (requires
  `workforce.dashboard.assign`) — **currently always returns 400; see Defect #1**
- `GET /my-dashboard` — the caller's own resolved dashboard, derived only from their own session's
  roles/scopes (no dedicated function grant required — same self-access pattern as viewing one's
  own profile)
- `GET /widgets/:widgetKey` — generic proxy/data endpoint for `proxy`-fetchMode widgets, enforcing
  that widget's own `requiredFunctions`; supports `?period=today|7d|30d|custom&from=&to=` for the
  transaction-summary widget — **the `transaction-summary` widget currently always returns 500;
  see Defect #2**

New authorization functions added to support this (confirmed via diff of
`src/authorization-catalogue/authorization-catalogue.seed.ts`): `reporting.transaction_summary.view`
(granted to `SUPER_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`,
`OPERATIONS`), `workforce.dashboard.view` and `workforce.dashboard.assign` (granted to
`SUPER_ADMIN` and `ADMINISTRATOR` only). The existing
`v1-administrator-role-and-assignment-implementation-01.integration.spec.ts` test asserting
ADMINISTRATOR's exact function-grant set was updated (9 → 11 grants) to include the two new
dashboard functions, with an inline comment explaining why — reviewed, correct, and consistent
with the rest of this report.

**Admin Web (`apps/admin-web/`): NOT IMPLEMENTED.** Confirmed via `find apps/admin-web -iname
"*dashboard*"` that the only dashboard-related file in the frontend is the pre-existing,
unmodified placeholder `src/screens/authenticated/DashboardScreen.tsx`. There is no new widget
rendering code, no dashboard-settings/template-assignment screen, and no API-client wiring for any
of the six endpoints above. **This is the single largest incomplete part of the original task.**

**Tests**: one new file, `test/v1-admin-configurable-dashboard-platform-01.integration.spec.ts`
(real PostgreSQL + real HTTP, no mocking of authorization), covering the 12 categories the
original task specified. Plus 17 small, mechanical updates to other integration tests' "latest
migration" assertion lists/regexes (to include the new migration) and one function-grant-count
update, all reviewed in this session and confirmed correct/non-behavioral. See §9 and §10 for exact
results.

## 9. Incomplete requirements, limitations, and risks (consolidated)

1. **Frontend (Admin Web) is 0% implemented.** No widgets, no settings screen, no API wiring.
2. **Defect #1** (§7): the dashboard-assignment change API is completely non-functional
   (`ValidationPipe` strips the undecorated DTO body) — an admin cannot actually reassign a role's
   dashboard template today, despite the underlying service-layer mechanism being correctly
   designed.
3. **Defect #2** (§7): the `transaction-summary` widget always returns `500` (SQL bind-parameter
   count mismatch for transaction tables without a fee column — `deposits`/`withdrawals`),
   affecting 5 of 11 roles' dashboards (every role with `reporting.transaction_summary.view`).
4. **No trend/period-over-period comparison widget exists** — the original task's "trends and
   comparisons" requirement has no corresponding implementation anywhere in the widget registry.
5. **Nothing for this task has been committed.** All backend code, the migration, the seed/catalogue
   changes, and the new test file exist only as uncommitted working-tree changes.
6. **The new dashboard-specific test suite had never successfully compiled, let alone run, before
   this recovery session** — it had ~7 TypeScript errors (untyped `Map` construction losing
   generic inference; a chained `.authorized` access on an inferred `{}` type) that were corrected
   in this session as a type-annotation-only fix (no test logic/assertions changed) solely to
   obtain a real pass/fail signal, per this task's instruction to run only the checks necessary to
   verify claims. This fix is included in the uncommitted `test/` file; it is a mechanical typing
   correction, not new test coverage.
7. Given defects #1 and #2, **the "assignment independent of permissions" and "new role reuses an
   existing template with zero code changes" claims (§2, §3) are architecturally correct by
   design/code-review but are currently unverified end-to-end**, because the only API path that
   would prove them is blocked by Defect #1.

## 10. Verification performed in this recovery session (exact commands and results)

All of the following were executed against a freshly provisioned embedded PostgreSQL instance
(`node scripts/embedded-pg.js`) and a `.env` reconstructed from `.env.example` with the same
`A2_FINANCE_ROLES_JSON`/`A2_MAKER_CHECKER_RULES_JSON`/`A2_WORKFORCE_RATE_LIMITS_JSON`/OIDC fixture
values this repository's own test suites expect. `node_modules` was freshly installed
(`npm ci`, 930 packages) since it does not persist between sandbox sessions.

| Check | Command | Result |
|---|---|---|
| TypeScript compile (whole repo, incl. new test file) | `npx tsc --noEmit -p .` | **Clean (0 errors)**, after fixing the 7 mechanical typing issues described in §9.6 |
| Production source build | `npx nest build` | **Success, exit 0** |
| Unit test suite | `npx jest --maxWorkers=2` | **174/174 suites passed, 1823/1823 tests passed** |
| Full existing PG integration suite (103 files, incl. the new dashboard file) | `npm run test:pg` | 1 pre-existing, unrelated test (`s-fix-01-customer-lifecycle-authorization...`) failed under concurrency due to a `beforeAll` hook timeout; **re-run in isolation it passed 7/7** (`npx jest --config jest.integration.config.js test/s-fix-01-customer-lifecycle-authorization.integration.spec.ts --runInBand`) — judged a transient resource-contention timeout in this sandbox, not a regression, since that file is untouched by this task |
| Dashboard-specific integration suite (the real proof-of-claims file) | `npx jest --config jest.integration.config.js test/v1-admin-configurable-dashboard-platform-01.integration.spec.ts --runInBand` | **28 passed, 10 failed, 38 total** — the 10 failures are fully explained by Defects #1 and #2 above; every other claim in this report backed by a specific test name passed |

No PG integration result in this report was assumed, inherited, or invented — all were produced by
the commands above, in this session, against this working tree's actual uncommitted code.

## 11. Changed-files summary (uncommitted, as of this report)

**New (untracked):**
- `src/dashboard/` — entities, service, controller, widget registry, widget-data service, seed
  service, templates seed, module (9 files, 1213 lines)
- `src/migrations/1785753600087-CreateDashboardPlatform.ts`
- `test/v1-admin-configurable-dashboard-platform-01.integration.spec.ts`

**Modified (22 files):**
- `src/app.module.ts` — registers `DashboardModule`
- `src/authorization-catalogue/authorization-catalogue.seed.ts` — adds
  `reporting.transaction_summary.view`, `workforce.dashboard.view`, `workforce.dashboard.assign`
  functions and their role grants
- `src/production/production-readiness.service.ts` — bumps expected-latest-migration constant to
  `1785753600087`/`CreateDashboardPlatform1785753600087`
- `test/production-readiness.spec.ts` — matching test-fixture update
- `test/support/pg-harness.ts` — adds `reseedDashboardPlatform()` (column names now confirmed
  correct against the migration DDL) and wires it into `truncateAllTables()`
- `test/v1-administrator-role-and-assignment-implementation-01.integration.spec.ts` — updates
  ADMINISTRATOR's expected function-grant count (9 → 11) for the two new dashboard functions
- 16 other `*.integration.spec.ts` files — mechanical updates to "latest migration" assertion
  lists/regexes to include the new migration; no behavioral changes (all reviewed via `git diff`
  in this session)

## 12. Conclusion and recommendation

The backend data model, authorization-enforcement, and fallback behavior for a configurable,
per-role dashboard platform are soundly designed and substantially verified (17/17 authorization
and fallback-focused tests pass against real PostgreSQL). However, this task is **not complete**:
two concrete, reproducible defects block the two most central claims (changing an assignment at
all, and the flagship transaction-summary metric), the entire Admin Web frontend is unbuilt, and
nothing has been committed. The prior "successful" status was inaccurate. Recommended next steps
for whoever picks this up: (1) fix Defect #1 (add class-validator decorators to
`AssignTemplateDto`), (2) fix Defect #2 (stop binding `$3` when `feeColumn` is null), (3) re-run
the dashboard integration suite to confirm 38/38, (4) build the Admin Web frontend, (5) commit the
backend+tests and the frontend together (or in reviewed stages) with an accurate commit message,
and only then consider the task complete.
